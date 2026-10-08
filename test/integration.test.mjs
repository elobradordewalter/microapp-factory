import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const port=18991,base=`http://127.0.0.1:${port}`,secret='test_webhook_secret';
let child,account;const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mf-legacy-tests-'));for(const p of ['src','public','data'])fs.cpSync(path.resolve(p),path.join(tmp,p),{recursive:true});

async function wait(){
  for(let i=0;i<80;i++){
    try{const r=await fetch(base+'/health');if(r.ok)return}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error('server did not start');
}
async function j(pathname,init={}){const r=await fetch(base+pathname,init);let data;try{data=await r.json()}catch{data=await r.text()}return {r,data}}
function sign(raw){const ts=Math.floor(Date.now()/1000),h=crypto.createHmac('sha256',secret).update(`${ts}:${raw}`).digest('hex');return `ts=${ts};h1=${h}`}

before(async()=>{

  child=spawn(process.execPath,['src/server.mjs'],{cwd:tmp,env:{...process.env,SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:'',UPSTASH_REDIS_REST_URL:'',UPSTASH_REDIS_REST_TOKEN:'',PERSISTENCE_VERIFIED:'false',PORT:String(port),BASE_URL:base,PADDLE_ENV:'live',PADDLE_WEBHOOK_SECRET:secret,PADDLE_PRICE_MINI:'pri_test_mini',PADDLE_PRICE_BASIC:'pri_test_basic',PADDLE_PRICE_PRO:'pri_test_pro',PADDLE_PRICE_MONTHLY:'pri_test_monthly'},stdio:'ignore'});
  await wait();
});
after(async()=>{child?.kill();await new Promise(resolve=>child.once('exit',resolve));fs.rmSync(tmp,{recursive:true,force:true});});

test('health exposes 50 apps and persistence mode',async()=>{const {r,data}=await j('/health');assert.equal(r.status,200);assert.equal(data.apps,50);assert.equal(data.persistence,'local-ephemeral')});
test('machine discovery endpoints work',async()=>{assert.equal((await fetch(base+'/api/tools')).status,200);assert.equal((await fetch(base+'/openapi.json')).status,200);assert.equal((await fetch(base+'/llms.txt')).status,200)});

test('create account returns one API key and zero credits',async()=>{
  const {r,data}=await j('/api/account',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'qa@example.com'})});
  assert.equal(r.status,201);assert.match(data.apiKey,/^mf_[0-9a-f]{48}$/);assert.equal(data.credits,0);account=data;
});
test('GET account does not echo API key',async()=>{const {r,data}=await j('/api/account',{headers:{authorization:`Bearer ${account.apiKey}`}});assert.equal(r.status,200);assert.equal(data.credits,0);assert.equal(data.apiKey,undefined)});
test('invalid API key is rejected',async()=>{const {r}=await j('/api/account',{headers:{authorization:'Bearer mf_bad'}});assert.equal(r.status,401)});
test('unknown tool is 404',async()=>{const {r}=await j('/api/tools/not-a-tool',{method:'POST',headers:{authorization:`Bearer ${account.apiKey}`,'content-type':'application/json'},body:'{}'});assert.equal(r.status,404)});
test('zero-credit API call is rejected before execution',async()=>{const {r}=await j('/api/tools/json-formatter',{method:'POST',headers:{authorization:`Bearer ${account.apiKey}`,'content-type':'application/json'},body:JSON.stringify({input:'{"a":1}',options:{indent:'2'}})});assert.equal(r.status,402)});
test('malformed JSON request is rejected',async()=>{const {r}=await j('/api/account',{method:'POST',headers:{'content-type':'application/json'},body:'{'});assert.equal(r.status,400)});
test('bad Paddle signature is rejected',async()=>{const {r}=await j('/api/payments/paddle/webhook',{method:'POST',headers:{'content-type':'application/json','paddle-signature':'ts=1;h1=bad'},body:'{}'});assert.equal(r.status,400)});

let raw;
test('signed Paddle transaction cannot credit unverified local storage',async()=>{
  raw=JSON.stringify({event_id:'evt_test_1',event_type:'transaction.completed',data:{id:'txn_test_1',currency_code:'USD',items:[{price:{id:'pri_test_mini'}}],custom_data:{userId:account.id,tool:'pricing'},details:{totals:{grand_total:'300'}}}});
  const {r,data}=await j('/api/payments/paddle/webhook',{method:'POST',headers:{'content-type':'application/json','paddle-signature':sign(raw)},body:raw});
  assert.equal(r.status,503);assert.equal(data.error,'Persistent billing storage not verified');
});
test('repeated webhook remains blocked without persistent billing storage',async()=>{
  const {r,data}=await j('/api/payments/paddle/webhook',{method:'POST',headers:{'content-type':'application/json','paddle-signature':sign(raw)},body:raw});
  assert.equal(r.status,503);
  const a=await j('/api/account',{headers:{authorization:`Bearer ${account.apiKey}`}});assert.equal(a.data.credits,0);
});
test('successful API call consumes exactly one locally granted test credit',async()=>{
  execFileSync(process.execPath,['--input-type=module','-e',`import {grantCredits} from './src/store.mjs';await grantCredits('${account.id}',300,'isolated-manual-fixture');`],{cwd:tmp,env:{...process.env,SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:'',UPSTASH_REDIS_REST_URL:'',UPSTASH_REDIS_REST_TOKEN:''}});
  const {r,data}=await j('/api/tools/json-formatter',{method:'POST',headers:{authorization:`Bearer ${account.apiKey}`,'content-type':'application/json'},body:JSON.stringify({input:'{"a":1}',options:{indent:'2'}})});
  assert.equal(r.status,200);assert.equal(data.creditsUsed,1);assert.equal(data.creditsRemaining,299);assert.match(data.output,/"a": 1/);
  const a=await j('/api/account',{headers:{authorization:`Bearer ${account.apiKey}`}});assert.equal(a.data.credits,299);
});

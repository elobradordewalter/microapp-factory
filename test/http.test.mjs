import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,cp,rm,readFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawn,execFileSync} from 'node:child_process';import crypto from 'node:crypto';
test('isolated HTTP and credit ledger integration',async()=>{
const dir=await mkdtemp(path.join(os.tmpdir(),'mf-test-'));for(const p of ['src','public','data'])await cp(new URL('../'+p,import.meta.url),path.join(dir,p),{recursive:true});
const secret='isolated-test-only',port=19000+Math.floor(Math.random()*10000),base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['src/server.mjs'],{cwd:dir,env:{...process.env,PORT:String(port),BASE_URL:base,PADDLE_WEBHOOK_SECRET:secret,PADDLE_PRICE_MINI:'pri_test',UPSTASH_REDIS_REST_URL:'',UPSTASH_REDIS_REST_TOKEN:'',PERSISTENCE_VERIFIED:'false',ADMIN_TOKEN:''},stdio:['ignore','pipe','pipe']});
try{await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',c=>reject(new Error('Server exited '+c)))});
const req=async(p,method='GET',body,headers={})=>fetch(base+p,{method,headers:{'content-type':'application/json',...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
for(const p of ['/health','/','/pricing','/privacy','/terms','/refunds','/contact','/robots.txt','/sitemap.xml','/tools/json-formatter','/tools/csv-cleaner','/tools/percentage-calculator','/openapi.json','/llms.txt'])assert.equal((await req(p)).status,200,p);
assert.equal((await req('/admin')).status,401);assert.equal((await (await req('/api/tools')).json()).tools.length,50);assert.equal((await (await req('/api/payments/paddle/config')).json()).enabled,false);
assert.equal((await req('/api/events','POST',{type:'purchase',revenue:500})).status,400);
const account=await (await req('/api/account','POST',{})).json();assert.equal(account.credits,0);const auth={authorization:`Bearer ${account.apiKey}`};
assert.equal((await req('/api/tools/json-formatter','POST',{input:'{}'})).status,401);
assert.equal((await req('/api/tools/not-real','POST',{input:'{}'},auth)).status,404);
assert.equal((await req('/api/tools/json-formatter','POST',{input:'{}'},auth)).status,402);
assert.equal((await req('/api/tools/json-formatter','POST','{',auth)).status,400);
assert.equal((await req('/api/tools/json-formatter','POST',{input:42},auth)).status,400);
const credit=()=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`import {grantCredits} from './src/store.mjs';console.log(JSON.stringify(await grantCredits('${account.id}',300,'txn_test')));`],{cwd:dir,env:{...process.env,UPSTASH_REDIS_REST_URL:'',UPSTASH_REDIS_REST_TOKEN:''}}));assert.equal(credit().credits,300);assert.equal(credit().duplicate,true);
const r=await req('/api/tools/json-formatter','POST',{input:'{"a":1}',options:{indent:'2'}},auth);assert.equal(r.status,200);const result=await r.json();assert.equal(result.output,'{\n  "a": 1\n}');assert.equal(result.creditsRemaining,299);
assert.equal((await req('/api/tools/json-formatter','POST',{input:'{'},auth)).status,400);
assert.equal((await (await req('/api/account','GET',undefined,auth)).json()).credits,299);
const raw=JSON.stringify({event_id:'evt_test',event_type:'transaction.completed',data:{id:'txn_test',custom_data:{userId:account.id},items:[{price:{id:'pri_test'}}]}}),ts=Math.floor(Date.now()/1000),sig=`ts=${ts};h1=${crypto.createHmac('sha256',secret).update(`${ts}:${raw}`).digest('hex')}`;
assert.equal((await req('/api/payments/paddle/webhook','POST',raw,{'paddle-signature':'wrong'})).status,400);
assert.equal((await req('/api/payments/paddle/webhook','POST',raw,{'paddle-signature':sig})).status,503);
const db=JSON.parse(await readFile(path.join(dir,'runtime/users.json'),'utf8'));assert.equal(db.ledger.length,2);assert.deepEqual(db.ledger.map(x=>[x.delta,x.balance_after]),[[300,300],[-1,299]]);assert(!Object.keys(db.apiKeys).includes(account.apiKey));assert.equal(Object.keys(db.apiKeys)[0].length,64);
}finally{child.kill();await new Promise(resolve=>child.once('exit',resolve));await rm(dir,{recursive:true,force:true});}
});

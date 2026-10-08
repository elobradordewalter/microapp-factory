// Requires a developer-only @electric-sql/pglite install. No production dependency.
import http from 'node:http';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const root=path.resolve(new URL('..',import.meta.url).pathname),db=new PGlite();
await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
await db.exec(await fs.readFile(path.join(root,'db/schema.sql'),'utf8'));
await db.exec(await fs.readFile(path.join(root,'db/verify.sql'),'utf8'));
const functions={mf_create_user:['p_id','p_email','p_key_hash'],mf_get_user:['p_key_hash'],mf_use_credits:['p_key_hash','p_credits','p_context'],mf_grant_credits:['p_user_id','p_credits','p_transaction_id','p_event_id','p_email','p_metadata'],mf_log_event:['p_event'],mf_dashboard_data:[]};
const rpc=http.createServer(async(req,res)=>{try{const name=req.url.split('/').pop(),params=functions[name];if(!params){res.writeHead(404);return res.end('{}')};let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw),values=params.map(k=>typeof b[k]==='object'?JSON.stringify(b[k]):b[k]);const r=await db.query(`select public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) as result`,values);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(r.rows[0].result));}catch(e){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({code:e.code}));}});
await new Promise(resolve=>rpc.listen(0,'127.0.0.1',resolve));const rpcUrl=`http://127.0.0.1:${rpc.address().port}`;
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mf-pg-e2e-'));for(const p of ['src','public','data'])await fs.cp(path.join(root,p),path.join(dir,p),{recursive:true});
const child=spawn(process.execPath,['src/server.mjs'],{cwd:dir,env:{...process.env,PORT:'0',BASE_URL:'http://localhost',SUPABASE_URL:rpcUrl,SUPABASE_SERVICE_ROLE_KEY:'local-only',PERSISTENCE_VERIFIED:'true',PADDLE_WEBHOOK_SECRET:'test-only',PADDLE_PRICE_MINI:'pri_mini',PADDLE_CLIENT_TOKEN:'test-only'},stdio:['ignore','pipe','pipe']});
// The production server logs the bound port when PORT=0.
let output='';
try{const base=await new Promise((resolve,reject)=>{child.stdout.on('data',c=>{output+=c;const m=output.match(/listening on .* port (\d+)/);if(m)resolve(`http://127.0.0.1:${m[1]}`)});child.once('error',reject);child.once('exit',c=>reject(new Error('Exited '+c)))});
const req=async(p,body,auth)=>{const r=await fetch(base+p,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+auth}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()}};
const a=(await req('/api/account',{})).data;assert.equal(a.credits,0);
const ev={event_id:'evt_e2e',event_type:'transaction.completed',data:{id:'txn_e2e',custom_data:{userId:a.id,tool:'json-formatter'},currency_code:'USD',details:{totals:{grand_total:'300'}},items:[{price:{id:'pri_mini'},quantity:1}]}};
async function webhook(event,bad=false){const raw=JSON.stringify(event),ts=Math.floor(Date.now()/1000),signature=`ts=${ts};h1=${crypto.createHmac('sha256','test-only').update(`${ts}:${raw}`).digest('hex')}`;const r=await fetch(base+'/api/payments/paddle/webhook',{method:'POST',headers:{'paddle-signature':bad?'bad':signature},body:raw});return {status:r.status,data:await r.json()}}
assert.equal((await webhook(ev,true)).status,400);assert.equal((await webhook(ev)).status,200);assert.equal((await req('/api/account',undefined,a.apiKey)).data.credits,300);
assert.equal((await webhook(ev)).data.result.duplicate,true);assert.equal((await webhook({...ev,event_id:'evt_second'})).data.result.duplicate,true);
const run=await req('/api/tools/json-formatter',{input:'{"x":1}',options:{indent:'2'}},a.apiKey);assert.equal(run.status,200);assert.equal(run.data.output,'{\n  "x": 1\n}');assert.equal(run.data.creditsRemaining,299);
assert.equal((await req('/api/tools/json-formatter',{input:'{'},a.apiKey)).status,400);assert.equal((await req('/api/tools/no-such',{input:'{}'},a.apiKey)).status,404);assert.equal((await req('/api/tools/json-formatter',{input:'{}'},'mf_wrong')).status,401);
const ledger=await db.query('select delta,balance_after,external_transaction_id from microforge_private.credit_ledger');assert.deepEqual(ledger.rows.map(x=>[Number(x.delta),Number(x.balance_after)]),[[300,300],[-1,299]]);assert(ledger.rows.every(x=>x.external_transaction_id));
const dashboard=(await db.query('select public.mf_dashboard_data() as d')).rows[0].d;assert.equal(Number(dashboard.revenueByCurrency.USD),3);assert.equal(dashboard.events.filter(e=>e.type==='purchase').length,1);assert.equal(dashboard.events.filter(e=>e.type==='api_process').length,1);
await db.query('select public.mf_use_credits($1,$2,$3)',[crypto.createHash('sha256').update(a.apiKey).digest('hex'),299,'{}']);assert.equal((await req('/api/tools/json-formatter',{input:'{}'},a.apiKey)).status,402);
console.log('PASS PostgreSQL schema, role ACL, signed HTTP webhook, credit grant/debit, ledger, duplicate event/transaction, analytics and API negative cases. Local isolated test; not Paddle LIVE or remote Supabase.');
}finally{child.kill();await new Promise(resolve=>child.once('exit',resolve));await new Promise(resolve=>rpc.close(resolve));await db.close();await fs.rm(dir,{recursive:true,force:true});}

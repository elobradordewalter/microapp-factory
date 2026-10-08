import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dir=path.resolve('runtime'); fs.mkdirSync(dir,{recursive:true});
const dbPath=path.join(dir,'store.json'); const eventsPath=path.join(dir,'events.ndjson');
const supabase=Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_ANON_KEY&&process.env.STORE_SECRET);
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
const load=()=>{try{return JSON.parse(fs.readFileSync(dbPath,'utf8'))}catch{return {users:{},apiKeyHashes:{},processedPayments:{},ledger:[],purchases:{},subscriptions:{}}}};
const save=db=>fs.writeFileSync(dbPath,JSON.stringify(db,null,2));

async function rpc(name,args={}){
  const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${name}`,{
    method:'POST',
    headers:{apikey:process.env.SUPABASE_ANON_KEY,authorization:`Bearer ${process.env.SUPABASE_ANON_KEY}`,'content-type':'application/json'},
    body:JSON.stringify({...args,p_secret:process.env.STORE_SECRET})
  });
  const t=await r.text();
  if(!r.ok)throw new Error(`Supabase ${name} failed (${r.status}): ${t.slice(0,300)}`);
  if(!t)return null;
  try{return JSON.parse(t)}catch{return t}
}

export async function createUser(email=''){
  const id=crypto.randomUUID(),apiKey='mf_'+crypto.randomBytes(24).toString('hex'),createdAt=new Date().toISOString(),mail=String(email||'').trim().toLowerCase();
  const keyHash=hash(apiKey),prefix=apiKey.slice(0,11);
  if(supabase){
    const u=await rpc('mf_create_user',{p_user_id:id,p_email:mail,p_api_key_hash:keyHash,p_api_key_prefix:prefix});
    return {...u,apiKey};
  }
  const db=load();db.users[id]={id,email:mail,credits:0,createdAt};db.apiKeyHashes[keyHash]={userId:id,prefix};save(db);return {...db.users[id],apiKey};
}

export async function getByApiKey(key){
  if(!key)return null; const keyHash=hash(key);
  if(supabase){const u=await rpc('mf_get_user_by_key',{p_api_key_hash:keyHash});return u&&u.id?{...u,apiKey:key}:null;}
  const db=load(),rec=db.apiKeyHashes[keyHash];const id=rec?.userId;return id&&db.users[id]?{...db.users[id],apiKey:key}:null;
}

export async function useCredits(key,n,meta={}){
  if(!key)throw Object.assign(new Error('Invalid API key'),{status:401});
  const keyHash=hash(key),amount=Number(n);
  if(!Number.isInteger(amount)||amount<=0)throw Object.assign(new Error('Invalid credit amount'),{status:400});
  if(supabase){
    const out=await rpc('mf_use_credits',{p_api_key_hash:keyHash,p_amount:amount,p_tool:String(meta.tool||''),p_latency_ms:Number(meta.latencyMs||0)});
    if(out?.error==='invalid_key')throw Object.assign(new Error('Invalid API key'),{status:401});
    if(out?.error==='insufficient_credits')throw Object.assign(new Error('Insufficient credits'),{status:402});
    return Number(out.credits);
  }
  const db=load(),rec=db.apiKeyHashes[keyHash],id=rec?.userId;if(!id||!db.users[id])throw Object.assign(new Error('Invalid API key'),{status:401});
  const u=db.users[id];if((u.credits||0)<amount)throw Object.assign(new Error('Insufficient credits'),{status:402});
  u.credits-=amount;db.ledger.push({id:crypto.randomUUID(),userId:id,delta:-amount,balanceAfter:u.credits,reason:'api_usage',source:meta.tool||'api',externalTransactionId:null,timestamp:new Date().toISOString()});save(db);return u.credits;
}

export async function grantCredits(userId,n,paymentId,email='',meta={}){
  const amount=Number(n);if(!userId||!Number.isInteger(amount)||amount<=0)throw new Error('Invalid credit grant');
  if(supabase)return await rpc('mf_grant_credits',{
    p_user_id:userId,p_amount:amount,p_payment_id:String(paymentId||''),p_event_id:String(meta.eventId||''),
    p_email:String(email||'').trim().toLowerCase(),p_amount_cents:Number(meta.amountCents||0),p_currency:String(meta.currency||''),
    p_price_id:String(meta.priceId||''),p_subscription_id:String(meta.subscriptionId||'')
  });
  const db=load();if(paymentId&&db.processedPayments[paymentId])return {duplicate:true};const u=db.users[userId];if(!u)throw new Error('Unknown account in payment');
  if(email&&!u.email)u.email=String(email).trim().toLowerCase();u.credits=(u.credits||0)+amount;
  if(paymentId){db.processedPayments[paymentId]=true;db.purchases[paymentId]={userId,credits:amount,amountCents:Number(meta.amountCents||0),currency:meta.currency||'',priceId:meta.priceId||'',createdAt:new Date().toISOString()};}
  if(meta.subscriptionId)db.subscriptions[meta.subscriptionId]={userId,priceId:meta.priceId||'',status:'active',updatedAt:new Date().toISOString()};
  db.ledger.push({id:crypto.randomUUID(),userId,delta:amount,balanceAfter:u.credits,reason:'purchase',source:'paddle',externalTransactionId:paymentId||null,timestamp:new Date().toISOString()});save(db);return {userId,credits:u.credits,duplicate:false};
}

export async function logEvent(event){
  const rec={...event,ts:new Date().toISOString()};
  if(supabase){await rpc('mf_log_event',{p_event:rec});return;}
  fs.appendFileSync(eventsPath,JSON.stringify(rec)+'\n');
}

function aggregate(events,users=0){
  const tools={};let revenue=0,cost=0,apiCalls=0,purchases=0,errors=0;const now=Date.now(),week=7*864e5;
  for(const e of events){
    if(e.type==='api_process')apiCalls++;if(e.type==='purchase')purchases++;if(e.type==='error')errors++;
    if(e.tool){tools[e.tool]??={visits:0,processes:0,api:0,conversions:0,revenue:0,errors:0,last7:0,prev7:0,cost:0};const t=Date.parse(e.ts||e.created_at||0);if(t>=now-week)tools[e.tool].last7++;else if(t>=now-2*week)tools[e.tool].prev7++;if(e.type==='view')tools[e.tool].visits++;if(e.type==='process')tools[e.tool].processes++;if(e.type==='api_process')tools[e.tool].api++;if(e.type==='purchase'){tools[e.tool].conversions++;tools[e.tool].revenue+=Number(e.revenue||0)}if(e.type==='error')tools[e.tool].errors++;tools[e.tool].cost+=Number(e.estimatedCostUsd||0)}
    if(e.type==='purchase')revenue+=Number(e.revenue||0);cost+=Number(e.estimatedCostUsd||0);
  }
  const rows=Object.entries(tools).map(([tool,v])=>({tool,...v,conversionRate:v.visits?Number(((v.conversions/v.visits)*100).toFixed(2)):0,growthPercent:v.prev7?Number((((v.last7-v.prev7)/v.prev7)*100).toFixed(1)):(v.last7?100:0)}));
  const contacts=events.filter(e=>e.type==='contact').slice(-20).reverse().map(e=>({email:String(e.email||''),message:String(e.message||''),ts:e.ts||e.created_at||''}));
  return {users,revenue,estimatedCostUsd:Number(cost.toFixed(6)),events:events.length,apiCalls,purchases,errors,contacts,tools:rows.sort((a,b)=>b.revenue-a.revenue||b.processes-a.processes),rankings:{traffic:[...rows].sort((a,b)=>b.visits-a.visits).slice(0,10),conversion:[...rows].filter(x=>x.visits>=1).sort((a,b)=>b.conversionRate-a.conversionRate).slice(0,10),revenue:[...rows].sort((a,b)=>b.revenue-a.revenue).slice(0,10),growth:[...rows].sort((a,b)=>b.growthPercent-a.growthPercent).slice(0,10)}};
}

export async function getDashboard(){
  if(supabase){const d=await rpc('mf_dashboard_data',{});return aggregate(d?.events||[],Number(d?.users||0));}
  const db=load();let events=[];try{events=fs.readFileSync(eventsPath,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)}catch{};return aggregate(events,Object.keys(db.users).length);
}

export const persistenceMode=()=>supabase?'supabase':'local-ephemeral';

import * as supabase from './supabase-store.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {hashKey} from './security.mjs';
const useSupabase=Boolean(process.env.SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY);
export const storageMode = useSupabase ? 'supabase' : process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? 'redis' : 'local';
export const paymentsReady = () => useSupabase && supabase.paymentsReady();

const dir=path.resolve('runtime'); fs.mkdirSync(dir,{recursive:true});
const usersPath=path.join(dir,'users.json'); const eventsPath=path.join(dir,'events.ndjson');
const remote=Boolean(process.env.UPSTASH_REDIS_REST_URL&&process.env.UPSTASH_REDIS_REST_TOKEN);
const load=()=>{try{return JSON.parse(fs.readFileSync(usersPath,'utf8'))}catch{return {users:{},apiKeys:{},processedPayments:{},ledger:[]}}};
const save=db=>fs.writeFileSync(usersPath,JSON.stringify(db,null,2));
const pairsToObj=a=>{const o={};for(let i=0;i<(a||[]).length;i+=2)o[a[i]]=a[i+1];if(o.credits!==undefined)o.credits=Number(o.credits);return o};
async function redis(...cmd){const r=await fetch(process.env.UPSTASH_REDIS_REST_URL,{method:'POST',headers:{authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,'content-type':'application/json'},body:JSON.stringify(cmd)});if(!r.ok)throw new Error(`Redis error ${r.status}`);const j=await r.json();if(j.error)throw new Error(j.error);return j.result;}

export async function createUser(email=''){
  if(useSupabase)return supabase.createUser(email);
  const id=crypto.randomUUID(),key='mf_'+crypto.randomBytes(20).toString('hex'),createdAt=new Date().toISOString(),mail=String(email||'').toLowerCase();
  if(remote){await redis('HSET',`mf:user:${id}`,'id',id,'email',mail,'credits','0','createdAt',createdAt);await redis('SET',`mf:key:${hashKey(key)}`,id);await redis('INCR','mf:users:count');return {id,email:mail,credits:0,createdAt,apiKey:key};}
  const db=load();db.users[id]={id,email:mail,credits:0,createdAt};db.apiKeys[hashKey(key)]=id;save(db);return {...db.users[id],apiKey:key};
}
export async function getByApiKey(key){
  if(useSupabase)return supabase.getByApiKey(key);
  if(remote){const id=await redis('GET',`mf:key:${hashKey(key)}`)||await redis('GET',`mf:key:${key}`);if(!id)return null;const u=pairsToObj(await redis('HGETALL',`mf:user:${id}`));return Object.keys(u).length?{...u,apiKey:key}:null;}
  const db=load();const id=db.apiKeys[hashKey(key)] || db.apiKeys[key];return id?{...db.users[id],apiKey:key}:null;
}
export async function useCredits(key,n,context={}){
  if(useSupabase)return supabase.useCredits(key,n,context);
  if(!Number.isSafeInteger(n)||n<=0)throw Object.assign(new Error('Invalid credit cost'),{status:400});
  if(remote){const id=await redis('GET',`mf:key:${hashKey(key)}`)||await redis('GET',`mf:key:${key}`);if(!id)throw Object.assign(new Error('Invalid API key'),{status:401});const script="local c=tonumber(redis.call('HGET',KEYS[1],'credits') or '-1'); if c < 0 then return -2 end; if c < tonumber(ARGV[1]) then return -1 end; return redis.call('HINCRBY',KEYS[1],'credits',-tonumber(ARGV[1]))";const v=Number(await redis('EVAL',script,'1',`mf:user:${id}`,String(n)));if(v===-1)throw Object.assign(new Error('Insufficient credits'),{status:402});if(v===-2)throw Object.assign(new Error('Invalid API key'),{status:401});return v;}
  const db=load();const id=db.apiKeys[hashKey(key)] || db.apiKeys[key];if(!id)throw Object.assign(new Error('Invalid API key'),{status:401});if((db.users[id].credits||0)<n)throw Object.assign(new Error('Insufficient credits'),{status:402});db.users[id].credits-=n;db.ledger??=[];db.ledger.push({user_id:id,delta:-n,balance_after:db.users[id].credits,reason:'api_usage',source:context.tool||'api',external_transaction_id:context.requestId||crypto.randomUUID(),timestamp:new Date().toISOString()});save(db);return db.users[id].credits;
}
export async function grantCredits(userId,n,paymentId,email='',metadata={}){
  if(useSupabase)return supabase.grantCredits(userId,n,paymentId,email,metadata);
  if(!Number.isSafeInteger(n)||n<=0||!paymentId)throw Object.assign(new Error('Invalid credit grant'),{status:422});
  if(remote){const script="if redis.call('GET',KEYS[2]) then return -1 end; if redis.call('EXISTS',KEYS[1]) == 0 then return -2 end; redis.call('SET',KEYS[2],'1'); if ARGV[2] ~= '' then redis.call('HSET',KEYS[1],'email',ARGV[2]) end; return redis.call('HINCRBY',KEYS[1],'credits',tonumber(ARGV[1]))";const v=Number(await redis('EVAL',script,'2',`mf:user:${userId}`,`mf:pay:${paymentId}`,String(n),String(email||'').toLowerCase()));if(v===-1)return {duplicate:true};if(v===-2)throw new Error('Unknown account in payment');return {userId,credits:v};}
  const db=load();if(paymentId&&db.processedPayments[paymentId])return {duplicate:true};const user=db.users[userId];if(!user)throw new Error('Unknown account in payment');if(email&&!user.email)user.email=String(email).toLowerCase();user.credits=(user.credits||0)+n;if(paymentId)db.processedPayments[paymentId]=true;db.ledger??=[];db.ledger.push({user_id:userId,delta:n,balance_after:user.credits,reason:'purchase',source:'paddle',external_transaction_id:paymentId,timestamp:new Date().toISOString()});save(db);return {user,credits:user.credits};
}
export async function logEvent(event){
  if(useSupabase)return supabase.logEvent(event);const rec=JSON.stringify({...event,ts:new Date().toISOString()});if(remote){await redis('LPUSH','mf:events',rec);await redis('LTRIM','mf:events','0','9999');return}fs.appendFileSync(eventsPath,rec+'\n');}
function aggregate(events,users=0){const tools={};let revenue=0,cost=0;const now=Date.now(),week=7*864e5;for(const e of events){if(e.tool){tools[e.tool]??={visits:0,processes:0,api:0,conversions:0,revenue:0,errors:0,last7:0,prev7:0,cost:0};const t=Date.parse(e.ts||0);if(t>=now-week)tools[e.tool].last7++;else if(t>=now-2*week)tools[e.tool].prev7++;if(e.type==='view')tools[e.tool].visits++;if(e.type==='process')tools[e.tool].processes++;if(e.type==='api_process')tools[e.tool].api++;if(e.type==='purchase'){tools[e.tool].conversions++;tools[e.tool].revenue+=Number(e.revenue||0)}if(e.type==='error')tools[e.tool].errors++;tools[e.tool].cost+=Number(e.estimatedCostUsd||0)}if(e.type==='purchase')revenue+=Number(e.revenue||0);cost+=Number(e.estimatedCostUsd||0)}const rows=Object.entries(tools).map(([tool,v])=>({tool,...v,conversionRate:v.visits?Number(((v.conversions/v.visits)*100).toFixed(2)):0,growthPercent:v.prev7?Number((((v.last7-v.prev7)/v.prev7)*100).toFixed(1)):(v.last7?100:0)}));return {users,revenue,estimatedCostUsd:Number(cost.toFixed(6)),events:events.length,tools:rows.sort((a,b)=>b.revenue-a.revenue||b.processes-a.processes),rankings:{traffic:[...rows].sort((a,b)=>b.visits-a.visits).slice(0,10),conversion:[...rows].filter(x=>x.visits>=1).sort((a,b)=>b.conversionRate-a.conversionRate).slice(0,10),revenue:[...rows].sort((a,b)=>b.revenue-a.revenue).slice(0,10),growth:[...rows].sort((a,b)=>b.growthPercent-a.growthPercent).slice(0,10)}}}
export async function getDashboard(){
  if(useSupabase)return supabase.getDashboard();
  if(remote){const users=Number(await redis('GET','mf:users:count')||0),raw=await redis('LRANGE','mf:events','0','9999')||[];return aggregate(raw.map(x=>{try{return JSON.parse(x)}catch{return null}}).filter(Boolean),users);}
  const db=load();let events=[];try{events=fs.readFileSync(eventsPath,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)}catch{};return aggregate(events,Object.keys(db.users).length);
}

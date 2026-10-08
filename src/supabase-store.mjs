import crypto from 'node:crypto';
import {hashKey} from './security.mjs';

// Server-only adapter. It never falls back to ephemeral files on network failure.
export const storageMode = 'supabase';
export const paymentsReady = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.PERSISTENCE_VERIFIED === 'true');
async function rpc(name, body = {}) {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) throw Object.assign(new Error('Persistent storage unavailable'), {status:503});
  let response;
  try {
    response = await fetch(`${url.replace(/\/$/,'')}/rest/v1/rpc/${name}`, {
      method:'POST', headers:{apikey:secret, authorization:`Bearer ${secret}`, 'content-type':'application/json'},
      body:JSON.stringify(body), signal:AbortSignal.timeout(10000)
    });
  } catch { throw Object.assign(new Error('Persistent storage unavailable'), {status:503}); }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const statuses = {PT400:400,PT401:401,PT402:402};
    const status = statuses[error.code] || 503;
    const message = {400:'Invalid payment or credit amount',401:'Invalid API key',402:'Insufficient credits'}[status] || 'Persistent storage unavailable';
    // Do not propagate database messages, URLs, headers or service credentials.
    throw Object.assign(new Error(message), {status});
  }
  if (response.status === 204) return null;
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}
function credits(n) {
  if (!Number.isSafeInteger(n) || n <= 0) throw Object.assign(new Error('Invalid credit amount'),{status:400});
  return n;
}
export async function createUser(email='') {
  const apiKey = `mf_${crypto.randomBytes(32).toString('hex')}`;
  const user = await rpc('mf_create_user', {p_id:crypto.randomUUID(),p_email:String(email || '').trim().toLowerCase(),p_key_hash:hashKey(apiKey)});
  return {...user,apiKey};
}
export async function getByApiKey(key) {
  if (typeof key !== 'string' || !key) return null;
  return rpc('mf_get_user',{p_key_hash:hashKey(key)});
}
export async function useCredits(key,n,context={}) {
  return rpc('mf_use_credits',{p_key_hash:hashKey(key),p_credits:credits(n),p_context:context});
}
export async function grantCredits(userId,n,paymentId,email='',metadata={}) {
  if (typeof paymentId !== 'string' || !paymentId) throw Object.assign(new Error('Missing transaction ID'),{status:400});
  return rpc('mf_grant_credits',{p_user_id:userId,p_credits:credits(n),p_transaction_id:paymentId,p_event_id:metadata.eventId || paymentId,p_email:String(email || '').toLowerCase(),p_metadata:metadata});
}
export async function logEvent(event) {
  const {apiKey,authorization,token,password,secret,...safe} = event;
  return rpc('mf_log_event',{p_event:{...safe,ts:new Date().toISOString()}});
}
export async function getDashboard() {
  const data = await rpc('mf_dashboard_data');
  const events = data.events || [], tools = {};
  let estimatedCostUsd=0;
  for (const e of events) {
    estimatedCostUsd += Number(e.estimatedCostUsd || 0);
    if (!e.tool) continue;
    const t = tools[e.tool] ||= {visits:0,processes:0,api:0,conversions:0,revenue:0,errors:0,cost:0,last7:0,prev7:0};
    const age=Date.now()-Date.parse(e.ts || 0);
    if(age>=0 && age<7*864e5)t.last7++;else if(age>=7*864e5 && age<14*864e5)t.prev7++;
    if(e.type==='view')t.visits++;
    if(e.type==='process')t.processes++;
    if(e.type==='api_process')t.api++;
    if(e.type==='purchase' && (!e.currency || e.currency==='USD')){t.conversions++;t.revenue+=Number(e.revenue || 0);}
    if(e.type==='error')t.errors++;
    t.cost+=Number(e.estimatedCostUsd || 0);
  }
  const rows=Object.entries(tools).map(([tool,t])=>({tool,...t,conversionRate:t.visits?100*t.conversions/t.visits:0,growthPercent:t.prev7?100*(t.last7-t.prev7)/t.prev7:t.last7?100:0}));
  return {users:data.users,revenue:Number(data.revenueByCurrency?.USD || 0),revenueByCurrency:data.revenueByCurrency,estimatedCostUsd,events:events.length,analyticsWindow:'latest 10000 events',tools:rows,rankings:{traffic:[...rows].sort((a,b)=>b.visits-a.visits).slice(0,10),conversion:[...rows].sort((a,b)=>b.conversionRate-a.conversionRate).slice(0,10),revenue:[...rows].sort((a,b)=>b.revenue-a.revenue).slice(0,10),growth:[...rows].sort((a,b)=>b.growthPercent-a.growthPercent).slice(0,10)}};
}

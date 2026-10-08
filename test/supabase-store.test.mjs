import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../src/supabase-store.mjs';

test('Supabase adapter hashes keys, sends transaction identities, fails closed', async () => {
  const oldFetch=globalThis.fetch;
  const oldUrl=process.env.SUPABASE_URL, oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL='https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-secret';
  const requests=[];
  globalThis.fetch=async (url,options)=>{
    requests.push({url,body:JSON.parse(options.body)});
    return new Response(JSON.stringify(url.endsWith('mf_create_user')?{id:'test-user',credits:0}:url.endsWith('mf_use_credits')?299:{credits:300}),{status:200});
  };
  try {
    const user=await store.createUser('TEST@example.com');
    assert.match(user.apiKey,/^mf_[a-f0-9]{64}$/);
    assert.equal(requests[0].body.p_email,'test@example.com');
    assert.match(requests[0].body.p_key_hash,/^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(requests[0].body).includes(user.apiKey));
    await store.grantCredits('test-user',300,'txn-test','',{eventId:'evt-test',revenue:3,currency:'USD'});
    assert.equal(requests[1].body.p_event_id,'evt-test');
    assert.equal(requests[1].body.p_transaction_id,'txn-test');
    assert.equal(await store.useCredits(user.apiKey,1,{tool:'json-formatter'}),299);
    await assert.rejects(store.useCredits(user.apiKey,-1),{status:400});
    await assert.rejects(store.grantCredits('test-user',300,''),{status:400});
    await store.logEvent({type:'view',apiKey:'do-not-log',password:'do-not-log'});
    assert.ok(!JSON.stringify(requests.at(-1).body).includes('do-not-log'));
    globalThis.fetch=async()=>new Response(JSON.stringify({code:'PT402',message:'database internals secret'}),{status:400});
    await assert.rejects(store.useCredits(user.apiKey,1),{status:402,message:'Insufficient credits'});
    globalThis.fetch=async()=>{throw new Error('network failure with secret');};
    await assert.rejects(store.getByApiKey(user.apiKey),{status:503,message:'Persistent storage unavailable'});
  } finally {
    globalThis.fetch=oldFetch;
    if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
    if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
  }
});

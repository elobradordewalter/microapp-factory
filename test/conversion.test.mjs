import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const client=readFileSync(new URL('../public/client.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');

test('customer can refresh purchased credits and copy API key on pricing',()=>{
  assert.match(server,/id="account-credit-status"/);
  assert.match(server,/id="refresh-balance"/);
  assert.match(server,/id="copy-key"/);
  assert.match(client,/fetch\('\/api\/account'/);
  assert.match(client,/clipboard\.writeText\(account\.apiKey\)/);
  assert.match(client,/cache:'no-store'/);
});
test('browser checkout UI remains syntactically valid',()=>{
  const checked=spawnSync(process.execPath,['--check','public/client.js'],{encoding:'utf8'});
  assert.equal(checked.status,0,checked.stderr);
});

test('API automation landing is linked, indexable and offers real demos',()=>{
  assert.match(server,/json-csv-api/);
  assert.match(server,/function jsonCsvLanding/);
  assert.match(server,/Try CSV to JSON free/);
  assert.match(server,/microforge\.postman_collection\.json/);
});

test('funnel acquisition and conversion improvements are present',()=>{
  assert.ok(server.includes('data-cta="tool-pricing"'));
  assert.ok(server.includes('Validate JSON. Clean CSV.'));
  assert.ok(server.includes('sessionHash'));
  assert.ok(server.includes('MF_PERSISTENCE_READ_PROBE_PASS'));
  assert.ok(!server.includes("const account = await createUser('');"));
  assert.ok(client.includes("event('page_view'"));
  assert.ok(client.includes("event('checkout_error'"));
});

test('public API discovery points to live payment readiness without obsolete billing warnings',()=>{
  const discovery=readFileSync(new URL('../src/discovery.mjs',import.meta.url),'utf8');
  assert.ok(server.includes('Check <a href="/health">GET /health</a>'));
  assert.ok(server.includes('[Payment readiness]'));
  assert.ok(discovery.includes('Check GET /health for paymentsReady'));
  for(const obsolete of [
    'Billing remains disabled until persistent storage has been verified',
    'Paid access is unavailable until billing storage is verified',
    'Availability of paid credits depends on verified billing storage'
  ]) {
    assert.ok(!server.includes(obsolete));
    assert.ok(!discovery.includes(obsolete));
  }
});

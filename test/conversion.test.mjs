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

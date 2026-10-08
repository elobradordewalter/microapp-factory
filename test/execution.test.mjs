import test from 'node:test';import assert from 'node:assert/strict';import {executeTool} from '../src/execution.mjs';
test('isolated worker returns expected output',async()=>assert.equal(await executeTool('json_format','{"a":1}',{indent:'2'}),'{\n  "a": 1\n}'));
test('CPU-heavy regex is terminated without blocking server',async()=>{await assert.rejects(executeTool('regex_test','a'.repeat(10000)+'!',{pattern:'(a+)+$',flags:'g'},200),{status:422});assert.equal(await executeTool('percentage','300',{percent:'15'}),'45');});

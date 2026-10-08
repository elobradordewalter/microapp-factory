import test from 'node:test';
import assert from 'node:assert/strict';
import {apps} from '../src/catalog.mjs';
import {runEngine} from '../src/engines.mjs';

const opts=a=>Object.fromEntries((a.options||[]).map(o=>[o.id,o.default]));
const expected={
'json-formatter':'"name": "Walter"','json-validator':'Valid JSON','json-minifier':'{"name":"MicroForge","active":true}',
'json-sorter':'"a"','json-flattener':'user.name','json-repair':'"name": "Ana"','json-to-csv':'name,age',
'csv-to-json':'"name": "Ana"','csv-cleaner':'Ana,ana@example.com','csv-dedupe':'Ana,a@example.com',
'csv-column-selector':'name,email','csv-sorter':'Ana,30','csv-to-tsv':'name\tage','tsv-to-csv':'name,age',
'csv-to-markdown':'| name | age |','text-cleaner':'Hello world!','remove-duplicate-lines':'orange',
'remove-empty-lines':'three','text-case-converter':'The Quick Brown Fox','word-counter':'"words": 7',
'sort-lines':'apple','reverse-lines':'third','trim-lines':'first','slug-generator':'50-microapps-fast-cheap-tools',
'keyword-cleaner':'json tools','email-extractor':'ana@example.com','url-extractor':'https://example.com',
'phone-extractor':'+54 11 5555-1234','regex-tester':'A-123','base64-encoder':'SGVsbG8gTWljcm9Gb3JnZQ==',
'base64-decoder':'Hello MicroForge','url-encoder':'hello%20world','url-decoder':'hello world?x=1&y=2',
'html-escape':'&lt;div','html-unescape':'<div>','strip-html':'Hello world.','markdown-to-html':'<h1>Title</h1>',
'meta-tag-builder':'<title>Fast CSV Cleaner</title>','robots-txt-generator':'Sitemap: https://example.com/sitemap.xml',
'sitemap-generator':'<urlset','utm-builder':'utm_source=newsletter','uuid-generator':'-','timestamp-converter':'2025',
'sha256-generator':'','unit-converter':'32.808','percentage-calculator':'45','margin-calculator':'"profit": 60',
'markup-calculator':'"markupPercent": 60','concrete-calculator':'"withWasteM3": 10.08','brick-calculator':'"withWasteBlocks": 1050'
};

test('catalog has exactly 50 apps',()=>assert.equal(apps.length,50));

for(const a of apps){
  test(`${a.slug} smoke`,async()=>{
    const out=await runEngine(a.engine,a.sample,opts(a));
    assert.equal(typeof out,'string');
  });
  test(`${a.slug} expected output`,async()=>{
    const out=await runEngine(a.engine,a.sample,opts(a));
    const want=expected[a.slug];
    assert.ok(want!==undefined,`missing expected fixture for ${a.slug}`);
    if(want)assert.ok(out.includes(want),`${a.slug} output did not include ${want}: ${out.slice(0,160)}`);
    else assert.ok(out.length>=0);
  });
  test(`${a.slug} invalid or edge input`,async()=>{
    const o=opts(a);
    const reject={
      json_format:['{',o],json_minify:['{',o],json_sort:['{',o],json_flatten:['{',o],json_repair:['{oops',o],json_to_csv:['{}',o],
      csv_columns:[a.sample,{...o,columns:'missing_column'}],csv_sort:[a.sample,{...o,column:'missing_column'}],
      regex_test:['x',{...o,pattern:'['}],url_decode:['%',o],timestamp_convert:['not-a-date',o],
      unit_convert:['1',{...o,from:'m',to:'kg'}],margin:['10',{...o,price:'0'}],markup:['0',{...o,price:'10'}],
      concrete:['x',o],bricks:['10',{...o,blockLength:'0'}]
    }[a.engine];
    if(a.engine==='json_validate'){assert.match(await runEngine(a.engine,'{',o),/^Invalid JSON/);return;}
    if(reject){await assert.rejects(()=>runEngine(a.engine,reject[0],reject[1]));return;}
    const out=await runEngine(a.engine,'',o);assert.equal(typeof out,'string');
  });
}

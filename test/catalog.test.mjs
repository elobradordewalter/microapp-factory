import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {apps} from '../src/catalog.mjs';
import {runEngine,parseCSV} from '../src/engines.mjs';
import {validateInput} from '../src/security.mjs';
const j = v => JSON.stringify(v,null,2);
// Independent known-result fixtures; every published tool must have a fixture.
const fixtures = {
'json-formatter':['{"a":1}',{},j({a:1})],
'json-validator':['[]',{},'Valid JSON\nType: array'],
'json-minifier':['{ "a": 1 }',{},'{"a":1}'],
'json-sorter':['{"z":0,"a":{"z":2,"b":1}}',{},j({a:{b:1,z:2},z:0})],
'json-flattener':['{"a":{"b":2},"c":[1]}',{},j({'a.b':2,c:'[1]'})],
'json-repair':["{a:'hello',}",{},j({a:'hello'})],
'json-to-csv':['[{"a":"x,y","b":2},{"a":"z"}]',{},'a,b\n"x,y",2\nz,'],
'csv-to-json':['a,b\n"x,y",2',{},j([{a:'x,y',b:'2'}])],
'csv-cleaner':[' a , b \n x , y \n\nx,y',{},'a,b\nx,y'],
'csv-dedupe':['a\nx\nx\ny',{},'a\nx\ny'],
'csv-column-selector':['a,b,c\nx,y,z',{columns:'c,a'},'c,a\nz,x'],
'csv-sorter':['name,n\nb,10\na,2',{column:'n'},'name,n\na,2\nb,10'],
'csv-to-tsv':['a,b\nx,y',{},'a\tb\nx\ty'],
'tsv-to-csv':['a\tb\nx,y\tz',{},'a,b\n"x,y",z'],
'csv-to-markdown':['a,b\nx,y',{},'| a | b |\n| --- | --- |\n| x | y |'],
'text-cleaner':[' \u200bHello   world \n\n\n next ',{},'Hello world\n\nnext'],
'remove-duplicate-lines':['a\nb\na',{},'a\nb'],
'remove-empty-lines':['a\n \n\nb',{},'a\nb'],
'text-case-converter':['hELLo WORLD',{case:'title'},'Hello World'],
'word-counter':['one two',{},j({words:2,characters:7,charactersNoSpaces:6,lines:1,readingMinutes:0.01})],
'sort-lines':['10\n2\n1',{},'1\n2\n10'],
'reverse-lines':['a\nb\nc',{},'c\nb\na'],
 'trim-lines':[' a \n b ',{},'a\nb'],
'slug-generator':['Árbol & Casa!',{},'arbol-casa'],
'keyword-cleaner':['JSON tools, json tools; csv',{},'JSON tools\ncsv'],
'email-extractor':['a@example.com a@example.com b@example.org',{},'a@example.com\nb@example.org'],
'url-extractor':['https://example.com https://example.com',{},'https://example.com'],
'phone-extractor':['Call +54 11 5555-1234',{},'+54 11 5555-1234'],
'regex-tester':['a1 b2',{pattern:'([a-z])(\\d)',flags:'g'},j([{match:'a1',index:0,groups:['a','1']},{match:'b2',index:3,groups:['b','2']}])],
'base64-encoder':['Hola ñ',{},'SG9sYSDDsQ=='],
'base64-decoder':['SG9sYSDDsQ==',{},'Hola ñ'],
'url-encoder':['a & ñ',{},'a%20%26%20%C3%B1'],
'url-decoder':['a%20%26%20%C3%B1',{},'a & ñ'],
'html-escape':['<b title="x">&\'</b>',{},'&lt;b title=&quot;x&quot;&gt;&amp;&#39;&lt;/b&gt;'],
'html-unescape':['&lt;b&gt;&amp;&#39;&quot;',{},'<b>&\'"'],
'strip-html':['<p>Hello <b>world</b></p>',{},'Hello world'],
'markdown-to-html':['# Hi\n\n**bold**',{},'<h1>Hi</h1>\n<p><strong>bold</strong></p>'],
'meta-tag-builder':['A & B',{description:'"quoted"',url:'https://example.com'},'<title>A &amp; B</title>\n<meta name="description" content="&quot;quoted&quot;">\n<link rel="canonical" href="https://example.com">\n<meta property="og:title" content="A &amp; B">\n<meta property="og:description" content="&quot;quoted&quot;">\n<meta property="og:url" content="https://example.com">'],
'robots-txt-generator':['https://example.com/',{},'User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml'],
'sitemap-generator':['https://example.com/?a=1&b=2',{},'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.com/?a=1&amp;b=2</loc></url>\n</urlset>'],
'utm-builder':['https://example.com/?x=1',{source:'a b',medium:'email',campaign:'launch'},'https://example.com/?x=1&utm_source=a+b&utm_medium=email&utm_campaign=launch'],
'uuid-generator':['3',{},v=>{const ids=v.split('\n');assert.equal(ids.length,3);assert.equal(new Set(ids).size,3);ids.forEach(id=>assert.match(id,/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/));}],
 'timestamp-converter':['1700000000',{},'2023-11-14T22:13:20.000Z'],
'sha256-generator':['abc',{},'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
'unit-converter':['1',{from:'m',to:'cm'},'100'],
'percentage-calculator':['250',{percent:'18'},'45'],
'margin-calculator':['100',{price:'160'},j({profit:60,marginPercent:37.5})],
'markup-calculator':['100',{price:'160'},j({profit:60,markupPercent:60})],
'concrete-calculator':['10',{width:'8',thickness:'12',waste:'5'},j({netM3:9.6,withWasteM3:10.08})],
'brick-calculator':['100',{blockLength:'50',blockHeight:'20',waste:'5'},j({blocksPerM2:10,netBlocks:1000,withWasteBlocks:1050})],
};
const csvEngines=new Set(['csv_to_json','csv_clean','csv_dedupe','csv_columns','csv_sort','csv_to_tsv','tsv_to_csv','csv_to_markdown']);
async function invalid(app){
  // All text APIs must reject structured input before executing an engine.
  for(const input of [null,{},[],true,10])assert.throws(()=>validateInput({input,options:{}}),/Expected input/);
  if(app.engine==='json_validate'){assert.match(await runEngine(app.engine,'{'),/^Invalid JSON/);return;}
  if(app.engine.startsWith('json_'))return assert.rejects(runEngine(app.engine,'{'));
  if(csvEngines.has(app.engine))return assert.rejects(runEngine(app.engine,'"unterminated',{}),/Unterminated/);
  const bad={regex_test:['text',{pattern:'['}],base64_decode:['%%%%',{}],url_decode:['%ZZ',{}],utm_builder:['not a URL',{}],uuid_generate:['NaN',{}],timestamp_convert:['not a date',{}],unit_convert:['x',{from:'m',to:'cm'}],percentage:['x',{percent:'10'}],margin:['x',{price:'1'}],markup:['x',{price:'1'}],concrete:['x',{width:'1',thickness:'1'}],bricks:['x',{blockLength:'1',blockHeight:'1'}]}[app.engine];
  if(bad)await assert.rejects(runEngine(app.engine,...bad));
}
test('Catalog has exactly 50 distinct tools and complete fixtures',()=>{assert.equal(apps.length,50);assert.equal(new Set(apps.map(a=>a.slug)).size,50);assert.deepEqual(Object.keys(fixtures).sort(),apps.map(a=>a.slug).sort());});
for(const app of apps)test(`${app.slug}: smoke, known output, invalid input`,async t=>{
  const start=performance.now();
  const defaults=Object.fromEntries(app.options.map(o=>[o.id,o.default]));
  assert.equal(typeof await runEngine(app.engine,app.sample,defaults),'string');
  const [input,options,expected]=fixtures[app.slug];validateInput({input,options});
  const output=await runEngine(app.engine,input,options);
  typeof expected==='function'?expected(output):assert.equal(output,expected);
  await invalid(app);
  t.diagnostic(`PASS ${app.slug} ${(performance.now()-start).toFixed(2)} ms`);
});
test('Regression: calculations reject missing, blank and nonfinite numbers',async()=>{for(const value of ['', ' ', 'Infinity',null,undefined,true])await assert.rejects(runEngine('percentage','10',{percent:value}));});
test('Regression: unknown units cannot return NaN',async()=>{await assert.rejects(runEngine('unit_convert','10',{from:'nope',to:'nope'}));});
test('Regression: fractional and negative Unix seconds',async()=>{assert.equal(await runEngine('timestamp_convert','1700000000.5'),'2023-11-14T22:13:20.500Z');assert.equal(await runEngine('timestamp_convert','-1'),'1969-12-31T23:59:59.000Z');});
test('Regression: quoted CSV supports commas, newlines and escaped quotes',()=>{assert.deepEqual(parseCSV('a,b\r\n"x,y","a""b"\r\n"line\nbreak",z'),[['a','b'],['x,y','a"b'],['line\nbreak','z']]);});
test('Regression: construction rejects negative quantities',async()=>{await assert.rejects(runEngine('concrete','-1',{width:'8',thickness:'12'}));await assert.rejects(runEngine('bricks','-1',{blockLength:'50',blockHeight:'20'}));});

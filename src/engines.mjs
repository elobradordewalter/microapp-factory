const stringify=(v)=>typeof v==='string'?v:JSON.stringify(v,null,2);
const escCsv=(v)=>{const s=String(v??'');return /[",\n\r]/.test(s)?`"${s.replaceAll('"','""')}"`:s};
export function parseCSV(input, delimiter=','){
  const rows=[]; let row=[], field='', q=false;
  for(let i=0;i<input.length;i++){
    const c=input[i];
    if(q){ if(c==='"'&&input[i+1]==='"'){field+='"';i++;} else if(c==='"')q=false; else field+=c; }
    else if(c==='"')q=true;
    else if(c===delimiter){row.push(field);field='';}
    else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}
    else field+=c;
  }
  row.push(field.replace(/\r$/,'')); if(row.some(x=>x!=='' )||rows.length===0)rows.push(row);
  return rows;
}
const toCSV=(rows,delimiter=',')=>rows.map(r=>r.map(escCsv).join(delimiter)).join('\n');
const sortObject=(v)=>Array.isArray(v)?v.map(sortObject):(v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sortObject(v[k])])):v);
const flatten=(obj,prefix='',out={})=>{for(const [k,v] of Object.entries(obj)){const key=prefix?`${prefix}.${k}`:k;if(v&&typeof v==='object'&&!Array.isArray(v))flatten(v,key,out);else out[key]=Array.isArray(v)?JSON.stringify(v):v;}return out};
const htmlEsc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const titleCase=s=>s.toLowerCase().replace(/\b\p{L}/gu,m=>m.toUpperCase());
const num=v=>{const n=Number(v);if(!Number.isFinite(n))throw new Error('Enter a valid number');return n};
function markdown(s){let out=htmlEsc(s);out=out.replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h1>$1</h1>').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>').replace(/`(.+?)`/g,'<code>$1</code>');out=out.replace(/(?:^|\n)(- .+(?:\n- .+)*)/g,m=>'<ul>'+m.trim().split('\n').map(x=>`<li>${x.slice(2)}</li>`).join('')+'</ul>');return out.split(/\n{2,}/).map(x=>/^<h\d|^<ul>/.test(x)?x:`<p>${x.replaceAll('\n','<br>')}</p>`).join('\n');}
function repairJSON(s){let x=s.trim();x=x.replace(/([{,]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g,'$1"$2"$3');x=x.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g,(_,a)=>`"${a.replaceAll('"','\\"')}"`);x=x.replace(/,\s*([}\]])/g,'$1');return JSON.stringify(JSON.parse(x),null,2)}
async function digestSHA256(input){if(globalThis.crypto?.subtle){const data=new TextEncoder().encode(input);const h=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('');} const {createHash}=await import('node:crypto');return createHash('sha256').update(input).digest('hex');}
export async function runEngine(engine,input='',options={}){
  const s=String(input??'');
  switch(engine){
    case 'json_format':{const ind=options.indent==='tab'?'\t':Number(options.indent||2);return JSON.stringify(JSON.parse(s),null,ind)}
    case 'json_validate':{try{const v=JSON.parse(s);return `Valid JSON\nType: ${Array.isArray(v)?'array':typeof v}`}catch(e){return `Invalid JSON\n${e.message}`}}
    case 'json_minify':return JSON.stringify(JSON.parse(s));
    case 'json_sort':return JSON.stringify(sortObject(JSON.parse(s)),null,2);
    case 'json_flatten':return JSON.stringify(flatten(JSON.parse(s)),null,2);
    case 'json_repair':return repairJSON(s);
    case 'json_to_csv':{const a=JSON.parse(s);if(!Array.isArray(a)||!a.every(x=>x&&typeof x==='object'&&!Array.isArray(x)))throw new Error('Input must be an array of objects');const keys=[...new Set(a.flatMap(Object.keys))];return toCSV([keys,...a.map(o=>keys.map(k=>o[k]??''))]);}
    case 'csv_to_json':{const r=parseCSV(s);const [h,...body]=r;return JSON.stringify(body.filter(x=>x.some(Boolean)).map(row=>Object.fromEntries(h.map((k,i)=>[k,row[i]??'']))),null,2)}
    case 'csv_clean':{let r=parseCSV(s).map(row=>row.map(x=>x.trim())).filter(row=>row.some(Boolean));if(options.dedupe!==false&&options.dedupe!=='false'){const seen=new Set();r=r.filter(row=>{const k=JSON.stringify(row);if(seen.has(k))return false;seen.add(k);return true})}return toCSV(r)}
    case 'csv_dedupe':{const r=parseCSV(s),seen=new Set();return toCSV(r.filter(row=>{const k=JSON.stringify(row);if(seen.has(k))return false;seen.add(k);return true}))}
    case 'csv_columns':{const r=parseCSV(s),[h,...b]=r;const want=String(options.columns||'').split(',').map(x=>x.trim()).filter(Boolean);if(!want.length)throw new Error('Enter at least one column');const idx=want.map(w=>{const i=h.indexOf(w);if(i<0)throw new Error(`Column not found: ${w}`);return i});return toCSV([want,...b.map(row=>idx.map(i=>row[i]??''))])}
    case 'csv_sort':{const r=parseCSV(s),[h,...b]=r;const i=h.indexOf(String(options.column||''));if(i<0)throw new Error('Column not found');b.sort((a,b)=>String(a[i]??'').localeCompare(String(b[i]??''),undefined,{numeric:true}));return toCSV([h,...b])}
    case 'csv_to_tsv':return parseCSV(s).map(r=>r.join('\t')).join('\n');
    case 'tsv_to_csv':return toCSV(parseCSV(s,'\t'));
    case 'csv_to_markdown':{const r=parseCSV(s);if(!r.length)return '';const h=r[0];return `| ${h.join(' | ')} |\n| ${h.map(()=> '---').join(' | ')} |\n`+r.slice(1).map(row=>`| ${row.join(' | ')} |`).join('\n')}
    case 'text_clean':return s.replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
    case 'remove_duplicate_lines':{const seen=new Set();return s.split(/\r?\n/).filter(x=>{if(seen.has(x))return false;seen.add(x);return true}).join('\n')}
    case 'remove_empty_lines':return s.split(/\r?\n/).filter(x=>x.trim()).join('\n');
    case 'case_convert':{const c=options.case||'title';if(c==='upper')return s.toUpperCase();if(c==='lower')return s.toLowerCase();if(c==='sentence')return s.toLowerCase().replace(/(^\s*\p{L}|[.!?]\s+\p{L})/gu,m=>m.toUpperCase());return titleCase(s)}
    case 'word_count':{const words=(s.trim().match(/\S+/g)||[]).length;return JSON.stringify({words,characters:s.length,charactersNoSpaces:s.replace(/\s/g,'').length,lines:s? s.split(/\r?\n/).length:0,readingMinutes:Number((words/225).toFixed(2))},null,2)}
    case 'character_count':return JSON.stringify({characters:s.length,charactersNoSpaces:s.replace(/\s/g,'').length},null,2);
    case 'sort_lines':{const a=s.split(/\r?\n/).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));if(options.direction==='desc')a.reverse();return a.join('\n')}
    case 'reverse_lines':return s.split(/\r?\n/).reverse().join('\n');
    case 'trim_lines':return s.split(/\r?\n/).map(x=>x.trim()).join('\n');
    case 'slugify':return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    case 'keyword_clean':{const parts=s.split(/[\n,;]+/).map(x=>x.trim().replace(/\s+/g,' ')).filter(Boolean);const map=new Map();for(const x of parts){const k=x.toLowerCase();if(!map.has(k))map.set(k,x)}return [...map.values()].join('\n')}
    case 'extract_emails':return [...new Set(s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[])].join('\n');
    case 'extract_urls':return [...new Set(s.match(/https?:\/\/[^\s<>'"\])]+/gi)||[])].join('\n');
    case 'extract_phones':return [...new Set((s.match(/(?:\+?\d[\d\s().-]{7,}\d)/g)||[]).map(x=>x.trim()))].join('\n');
    case 'regex_test':{const flags=String(options.flags||'g');const re=new RegExp(String(options.pattern||''),flags);const all=[];if(flags.includes('g')){for(const m of s.matchAll(re))all.push({match:m[0],index:m.index,groups:m.slice(1)});}else{const m=s.match(re);if(m)all.push({match:m[0],index:m.index,groups:m.slice(1)});}return JSON.stringify(all,null,2)}
    case 'base64_encode':return typeof btoa==='function'?btoa(unescape(encodeURIComponent(s))):Buffer.from(s,'utf8').toString('base64');
    case 'base64_decode':return typeof atob==='function'?decodeURIComponent(escape(atob(s.trim()))):Buffer.from(s.trim(),'base64').toString('utf8');
    case 'url_encode':return encodeURIComponent(s);
    case 'url_decode':return decodeURIComponent(s);
    case 'html_escape':return htmlEsc(s);
    case 'html_unescape':return s.replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&amp;','&');
    case 'strip_html':return s.replace(/<\s*br\s*\/?\s*>/gi,'\n').replace(/<\/(p|div|li|h\d)>/gi,'\n').replace(/<[^>]*>/g,'').replace(/\n{3,}/g,'\n\n').trim();
    case 'markdown_to_html':return markdown(s);
    case 'meta_tags':{const title=htmlEsc(s.trim()),desc=htmlEsc(String(options.description||'')),url=htmlEsc(String(options.url||''));return `<title>${title}</title>\n<meta name="description" content="${desc}">\n<link rel="canonical" href="${url}">\n<meta property="og:title" content="${title}">\n<meta property="og:description" content="${desc}">\n<meta property="og:url" content="${url}">`}
    case 'robots_txt':{const u=s.trim().replace(/\/$/,'');return `User-agent: *\nAllow: /\n\nSitemap: ${u}/sitemap.xml`}
    case 'sitemap_xml':{const urls=s.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u=>`  <url><loc>${htmlEsc(u)}</loc></url>`).join('\n')}\n</urlset>`}
    case 'utm_builder':{const u=new URL(s.trim());for(const k of ['source','medium','campaign']){const v=options[k];if(v)u.searchParams.set(`utm_${k}`,v)}return u.toString()}
    case 'uuid_generate':{const n=Math.max(1,Math.min(100,num(s||1)));return Array.from({length:n},()=>crypto.randomUUID()).join('\n')}
    case 'timestamp_convert':{const x=s.trim();if(/^\d+(\.\d+)?$/.test(x)){const n=Number(x);const ms=x.length<=10?n*1000:n;return new Date(ms).toISOString()}const d=new Date(x);if(Number.isNaN(d.getTime()))throw new Error('Enter a Unix timestamp or valid date');return JSON.stringify({unixSeconds:Math.floor(d.getTime()/1000),unixMilliseconds:d.getTime(),iso:d.toISOString()},null,2)}
    case 'sha256':return await digestSHA256(s);
    case 'unit_convert':{const from=options.from,to=options.to,v=num(s);const kind={m:'len',cm:'len',mm:'len',km:'len',ft:'len',in:'len',kg:'mass',g:'mass',lb:'mass',C:'temp',F:'temp'};if(kind[from]!==kind[to])throw new Error('Choose compatible unit types');if(kind[from]==='temp'){let c=from==='C'?v:(v-32)*5/9;return String(to==='C'?c:c*9/5+32)}const factors={m:1,cm:.01,mm:.001,km:1000,ft:.3048,in:.0254,kg:1,g:.001,lb:.45359237};return String(v*factors[from]/factors[to])}
    case 'percentage':return String(num(s)*num(options.percent)/100);
    case 'margin':{const cost=num(s),price=num(options.price);if(price===0)throw new Error('Selling price cannot be zero');return JSON.stringify({profit:price-cost,marginPercent:Number((((price-cost)/price)*100).toFixed(2))},null,2)}
    case 'markup':{const cost=num(s),price=num(options.price);if(cost===0)throw new Error('Cost cannot be zero');return JSON.stringify({profit:price-cost,markupPercent:Number((((price-cost)/cost)*100).toFixed(2))},null,2)}
    case 'concrete':{const L=num(s),W=num(options.width),T=num(options.thickness)/100,w=num(options.waste||0)/100;const net=L*W*T;return JSON.stringify({netM3:Number(net.toFixed(3)),withWasteM3:Number((net*(1+w)).toFixed(3))},null,2)}
    case 'bricks':{const area=num(s),bl=num(options.blockLength)/100,bh=num(options.blockHeight)/100,w=num(options.waste||0)/100;if(bl<=0||bh<=0)throw new Error('Block dimensions must be positive');const per=1/(bl*bh);return JSON.stringify({blocksPerM2:Number(per.toFixed(2)),netBlocks:Math.ceil(area*per),withWasteBlocks:Math.ceil(area*per*(1+w))},null,2)}
    default:throw new Error(`Unknown engine: ${engine}`);
  }
}

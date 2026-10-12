import {apps} from '../src/catalog.mjs';

const base=(process.env.BASE_URL||'https://microforge.onrender.com').replace(/\/$/,'');
const host=new URL(base).host;
const key='1bd3fafdde80dc0ffe027d7c3798030d';
const paths=['','tools','json-csv-api','pricing','api-docs','privacy','terms','refunds','contact',...apps.map(app=>`tools/${app.slug}`)];
const urlList=paths.map(value=>`${base}/${value}`);

if(process.argv.includes('--dry-run')){
  console.log(JSON.stringify({host,keyLocation:`${base}/${key}.txt`,urlCount:urlList.length},null,2));
  process.exit(0);
}

const response=await fetch('https://api.indexnow.org/indexnow',{
  method:'POST',
  headers:{'content-type':'application/json; charset=utf-8'},
  body:JSON.stringify({host,key,keyLocation:`${base}/${key}.txt`,urlList})
});

if(!response.ok&&response.status!==202)throw new Error(`IndexNow submission failed: HTTP ${response.status}`);
console.log(JSON.stringify({ok:true,status:response.status,host,urlCount:urlList.length}));

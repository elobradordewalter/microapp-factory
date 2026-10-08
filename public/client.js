import {runEngine} from '/engines.js';
const q=(s,r=document)=>r.querySelector(s);
function session(){let x=localStorage.getItem('mf_session');if(!x){x=crypto.randomUUID();localStorage.setItem('mf_session',x)}return x}
function event(type,tool,extra={}){fetch('/api/events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type,tool,sessionId:session(),source:new URLSearchParams(location.search).get('utm_source'),...extra})}).catch(()=>{})}
const root=q('[data-tool]');
if(root){const tool=root.dataset.tool,engine=root.dataset.engine,input=q('#input'),output=q('#output'),status=q('#status'),file=q('#file-input');event('view',tool);if(file)file.onchange=async()=>{const f=file.files?.[0];if(!f)return;input.value=await f.text();status.textContent=`Loaded ${f.name} locally · ${(f.size/1024).toFixed(1)} KB`;};q('#run').onclick=async()=>{status.textContent='';try{const opts={};root.querySelectorAll('[data-opt]').forEach(el=>opts[el.dataset.opt]=el.type==='checkbox'?el.checked:el.value);const t=performance.now();output.value=await runEngine(engine,input.value,opts);status.textContent=`Done in ${Math.max(1,Math.round(performance.now()-t))} ms · processed locally`;event('process',tool,{bytes:input.value.length});}catch(e){status.textContent=e.message;event('error',tool,{message:e.message})}};q('#clear').onclick=()=>{input.value='';output.value='';status.textContent=''};q('#copy').onclick=async()=>{await navigator.clipboard.writeText(output.value);status.textContent='Copied'};q('#download').onclick=()=>{const b=new Blob([output.value],{type:'text/plain;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`${tool}-result.txt`;a.click();URL.revokeObjectURL(a.href)};q('#run').click();}
const search=q('#tool-search');if(search)search.addEventListener('input',()=>document.querySelectorAll('[data-search]').forEach(x=>x.hidden=!x.dataset.search.includes(search.value.toLowerCase().trim())));
const buyButtons=[...document.querySelectorAll('[data-buy]')];
if(buyButtons.length){
  const status=q('#payment-status');
  (async()=>{
    try{
      const cfg=await (await fetch('/api/payments/paddle/config')).json();
      if(!cfg.enabled){status.textContent='Payments are not live yet: merchant onboarding and live Paddle credentials are still required.';buyButtons.forEach(b=>b.disabled=true);return;}
      const account=JSON.parse(localStorage.getItem('mf_account')||'null') || await (await fetch('/api/account',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json();
      localStorage.setItem('mf_account',JSON.stringify(account));
      if(cfg.environment==='sandbox'&&window.Paddle?.Environment) Paddle.Environment.set('sandbox');
      Paddle.Initialize({token:cfg.clientToken});
      status.textContent=`Shared account ready · ${account.credits||0} credits`;
      buyButtons.forEach(btn=>btn.onclick=()=>{
        const priceId=cfg.prices[btn.dataset.buy];
        if(!priceId){status.textContent='This pack is not configured yet.';return;}
        Paddle.Checkout.open({items:[{priceId,quantity:1}],customData:{userId:account.id,tool:'pricing'}});
      });
    }catch(e){status.textContent=`Payments unavailable: ${e.message}`;buyButtons.forEach(b=>b.disabled=true);}
  })();
}

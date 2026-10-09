import {runEngine} from '/engines.js';
const q=(s,r=document)=>r.querySelector(s);
function session(){let x=localStorage.getItem('mf_session');if(!x){x=crypto.randomUUID();localStorage.setItem('mf_session',x)}return x}
function event(type,tool,extra={}){fetch('/api/events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type,tool,sessionId:session(),source:new URLSearchParams(location.search).get('utm_source'),page:location.pathname,...extra})}).catch(()=>{})}
const root=q('[data-tool]');
if(!root&&['/','/tools','/json-csv-api','/pricing','/api-docs'].includes(location.pathname))event('page_view',location.pathname==='/pricing'?'pricing':null);
document.addEventListener('click',e=>{const a=e.target.closest?.('a[data-cta]');if(a)event('cta_click',root?.dataset.tool||'pricing',{cta:a.dataset.cta});});
if(root){const tool=root.dataset.tool,engine=root.dataset.engine,input=q('#input'),output=q('#output'),status=q('#status'),file=q('#file-input');event('view',tool);if(file)file.onchange=async()=>{const f=file.files?.[0];if(!f)return;input.value=await f.text();status.textContent=`Loaded ${f.name} locally · ${(f.size/1024).toFixed(1)} KB`;};q('#run').onclick=async()=>{status.textContent='';try{const opts={};root.querySelectorAll('[data-opt]').forEach(el=>opts[el.dataset.opt]=el.type==='checkbox'?el.checked:el.value);const t=performance.now();output.value=await runEngine(engine,input.value,opts);status.textContent=`Done in ${Math.max(1,Math.round(performance.now()-t))} ms · processed locally`;event('process',tool,{bytes:input.value.length});}catch(e){status.textContent=e.message;event('browser_error',tool,{message:e.message})}};q('#clear').onclick=()=>{input.value='';output.value='';status.textContent=''};q('#copy').onclick=async()=>{await navigator.clipboard.writeText(output.value);status.textContent='Copied'};q('#download').onclick=()=>{const b=new Blob([output.value],{type:'text/plain;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`${tool}-result.txt`;a.click();URL.revokeObjectURL(a.href)};}
const search=q('#tool-search');if(search)search.addEventListener('input',()=>document.querySelectorAll('[data-search]').forEach(x=>x.hidden=!x.dataset.search.includes(search.value.toLowerCase().trim())));
const buyButtons=[...document.querySelectorAll('[data-buy]')];
if(buyButtons.length){
  const status=q('#payment-status');
  const accountStatus=q('#account-credit-status');
  const keyButton=q('#copy-key');
  const refreshButton=q('#refresh-balance');
  let account=null;
  async function refreshBalance(){
    if(!account?.apiKey)return null;
    try{
      const r=await fetch('/api/account',{headers:{Authorization:'Bearer '+account.apiKey},cache:'no-store'});
      if(!r.ok)throw new Error('Account verification failed ('+r.status+')');
      const current=await r.json();
      account={...account,...current,apiKey:account.apiKey};
      localStorage.setItem('mf_account',JSON.stringify(account));
      if(accountStatus)accountStatus.textContent='Verified balance: '+account.credits+' credits';
      return account.credits;
    }catch(e){
      if(accountStatus)accountStatus.textContent='Could not verify balance: '+e.message+'. Please retry.';
      return null;
    }
  }
  (async()=>{
    try{
      const cfgResponse=await fetch('/api/payments/paddle/config',{cache:'no-store'});
      if(!cfgResponse.ok)throw new Error('Checkout configuration unavailable');
      const cfg=await cfgResponse.json();
      if(!cfg.enabled){
        status.textContent='Payments are temporarily unavailable while billing and persistent storage are verified.';
        buyButtons.forEach(b=>b.disabled=true);
        if(accountStatus)accountStatus.textContent='Payment service temporarily unavailable.';
        return;
      }
      try{account=JSON.parse(localStorage.getItem('mf_account')||'null')}catch{}
      if(!account?.apiKey){
        const response=await fetch('/api/account',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
        if(!response.ok)throw new Error('Could not create your API account');
        account=await response.json();
        if(!account.apiKey||!account.id)throw new Error('Incomplete account response');
        localStorage.setItem('mf_account',JSON.stringify(account));
      }
      if(keyButton){
        keyButton.disabled=false;
        keyButton.onclick=async()=>{
          try{
            await navigator.clipboard.writeText(account.apiKey);
            if(accountStatus)accountStatus.textContent='API key copied. Keep it private and save it somewhere secure.';
          }catch{
            if(accountStatus)accountStatus.textContent='Clipboard permission denied. Use a supported HTTPS browser to save your key.';
          }
        };
      }
      if(refreshButton)refreshButton.onclick=()=>refreshBalance();
      await refreshBalance();
      if(cfg.environment==='sandbox'&&window.Paddle?.Environment)Paddle.Environment.set('sandbox');
      if(!window.Paddle?.Initialize)throw new Error('Paddle checkout did not load');
      Paddle.Initialize({token:cfg.clientToken,eventCallback:data=>{
        if(data?.name==='checkout.completed'){
          event('checkout_completed','pricing');
          if(accountStatus)accountStatus.textContent='Checkout finished. Verifying paid credits with our server…';
          [800,3000,8000].forEach(delay=>setTimeout(()=>refreshBalance(),delay));
        }
        if(data?.name==='checkout.error'){
          event('checkout_error','pricing');
          const code=String(data.code||data.type||'unknown').slice(0,80);
          status.textContent='Paddle checkout error: '+code+' — '+String(data.detail||'Check Checkout configuration.').slice(0,220);
          console.error('MicroForge Paddle checkout error',{code,detail:data.detail,documentation_url:data.documentation_url});
        }
      }});
      status.textContent='Checkout ready · purchase credits for authenticated API requests.';
      buyButtons.forEach(btn=>btn.onclick=()=>{
        const priceId=cfg.prices[btn.dataset.buy];
        if(!priceId){status.textContent='This pack is not configured yet.';return;}
        event('checkout_started','pricing');
        Paddle.Checkout.open({items:[{priceId,quantity:1}],customData:{userId:account.id,tool:'pricing'}});
      });
      document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshBalance()});
    }catch(e){
      status.textContent='Payments unavailable: '+e.message;
      buyButtons.forEach(b=>b.disabled=true);
    }
  })();
}

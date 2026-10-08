import {Worker} from 'node:worker_threads';
let active=0;
export function executeTool(engine,input,options={},timeoutMs=2000){
  if(active>=8)return Promise.reject(Object.assign(new Error('Execution capacity reached; retry later'),{status:503}));
  active++;
  return new Promise((resolve,reject)=>{
    let settled=false,worker,timer;
    const finish=(err,output)=>{if(settled)return;settled=true;active--;clearTimeout(timer);worker?.terminate();err?reject(err):resolve(output);};
    try{worker=new Worker(new URL('./engine-worker.mjs',import.meta.url),{workerData:{engine,input,options},resourceLimits:{maxOldGenerationSizeMb:32,maxYoungGenerationSizeMb:8,stackSizeMb:2}});}catch{finish(Object.assign(new Error('Execution unavailable'),{status:503}));return;}
    timer=setTimeout(()=>finish(Object.assign(new Error('Execution exceeded time limit'),{status:422})),timeoutMs);
    worker.once('message',m=>m.error?finish(Object.assign(new Error(m.error),{status:400})):finish(null,m.output));
    worker.once('error',()=>finish(Object.assign(new Error('Execution exceeded resource limits'),{status:422})));
    worker.once('exit',()=>{if(!settled)finish(Object.assign(new Error('Execution unavailable'),{status:503}));});
  });
}

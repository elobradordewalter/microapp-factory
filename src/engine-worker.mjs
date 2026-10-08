import {parentPort,workerData} from 'node:worker_threads';
import {runEngine} from './engines.mjs';
try{parentPort.postMessage({output:await runEngine(workerData.engine,workerData.input,workerData.options)});}catch(e){parentPort.postMessage({error:String(e.message).slice(0,300)});}

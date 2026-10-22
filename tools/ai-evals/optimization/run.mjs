#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {anthropicRequest} from '../claude-transport.mjs';
import {requestFor,RATES} from './requests.mjs';
import {score} from './score.mjs';
import {CAPS,usage,authorize} from './budget.mjs';
import {stopAfterStagnation} from './selection.mjs';
const root='tools/ai-evals/optimization', dir=root+'/results';fs.mkdirSync(dir,{recursive:true});
const hash=s=>createHash('sha256').update(s).digest('hex');
const benchmark=fs.readFileSync(root+'/benchmark.json','utf8'), benchmarkHash=hash(benchmark);
if(JSON.parse(fs.readFileSync(root+'/manifest.json','utf8')).benchmarkSha256!==benchmarkHash)throw new Error('Frozen manifest mismatch');
const manifest=JSON.parse(fs.readFileSync(root+'/manifest.json','utf8'));
for(const [file,key] of [['score.mjs','evaluatorSha256'],['requests.mjs','requestsSha256']])if(hash(fs.readFileSync(root+'/'+file,'utf8'))!==manifest[key])throw new Error('Frozen evaluator/request builder changed');
const cases=JSON.parse(benchmark),statePath=dir+'/state.json';
export const promptFiles={radar:'lib/radar-chat-prompt.js',devis:'lib/devis-chat-prompt.js',assistant:'app/api/koji-assistant/route.js'};
function write(file,value) {
 const str=JSON.stringify(value,null,2)+'\n';
 for(const k of ['ANTHROPIC_API_KEY','ANTHROPIC_WORKSPACE_ID']) if(process.env[k]&&str.includes(process.env[k])) throw new Error('Secret reflection; write blocked');
 const tmp=file+'.tmp';const fd=fs.openSync(tmp,'w');try{fs.writeFileSync(fd,str);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);const directory=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
}
let state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{benchmarkHash,base:'59cffa6',limits:CAPS,attempts:[],runs:{},iterations:[],best:{radar:'baseline',devis:'baseline',assistant:'baseline'},finalRemaining:45,validationOpened:false,createdAt:new Date().toISOString(),pricing:{source:'https://platform.claude.com/docs/en/about-claude/pricing',rates:RATES,verifiedAt:'2026-10-22T16:02:38.065Z'}};
const save=()=>write(statePath,state);
if(state.benchmarkHash!==benchmarkHash) throw new Error('Frozen benchmark changed');
const [command,phase,module]=process.argv.slice(2);
if(command==='status'){console.log(JSON.stringify({usage:usage(state.attempts),best:state.best,iterations:state.iterations,finalRemaining:state.finalRemaining,validationOpened:state.validationOpened},null,2));process.exit(0);}
if(command!=='run'||!phase||!/^(baseline|iter-[1-8]|final-dev|final-validation)$/.test(phase)) throw new Error('Usage: run.mjs run baseline|iter-N|final-dev|final-validation [radar|devis|assistant]');
const final=phase.startsWith('final-');
if(final&&module)throw new Error('Final phases must include their entire split');
if(!final&&(state.validationOpened||state.runs['final-dev'])) throw new Error('Validation already opened; optimization closed');
if(phase.startsWith('iter-')&&stopAfterStagnation(state.iterations)) throw new Error('STOP_TWO_NO_GAIN');
if(phase==='final-validation'&&!state.runs['final-dev']?.completed) throw new Error('Final dev must complete before validation');
if(phase==='baseline'&&module) throw new Error('Baseline must include all 30 development cases');
if(phase.startsWith('iter-')&&(!state.runs.baseline?.completed||!['radar','devis','assistant'].includes(module))) throw new Error('Baseline/module prerequisite');
if(phase.startsWith('iter-')&&state.iterations.length>=8) throw new Error('STOP_ITERATIONS');
if(phase.startsWith('iter-')&&Number(phase.slice(5))!==state.iterations.length+1) throw new Error('Iterations must be sequential and decided');
if(phase.startsWith('iter-')) {
 const previous=dir+'/prompts/'+state.best[module]+'/'+module+'.js';
 if(fs.readFileSync(previous,'utf8')===fs.readFileSync(promptFiles[module],'utf8'))throw new Error('No prompt change; refuse accidental paid rerun');
}
const selected=cases.filter(c=>c.split===(phase==='final-validation'?'validation':'dev')&&(!module||c.assistant===module));
const fingerprint=hash(Object.values(promptFiles).map(f=>fs.readFileSync(f,'utf8')).join('\n'));
if(state.runs[phase]?.fingerprint&&state.runs[phase].fingerprint!==fingerprint) throw new Error('Cannot resume with changed prompts');
const lock=dir+'/running.lock';const fd=fs.openSync(lock,'wx');fs.closeSync(fd);
try {
 const env=Object.fromEntries(['PATH','HOME','TMPDIR'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
 const tests=spawnSync(process.execPath,['--test','tools/ai-evals/optimization.test.mjs'],{env,encoding:'utf8',timeout:30000});
 if(tests.status!==0)throw new Error('Offline guard tests failed; no API request allowed');
 if(!process.env.ANTHROPIC_API_KEY||!process.env.ANTHROPIC_WORKSPACE_ID) throw new Error('Missing API/workspace binding');
 const run=state.runs[phase]||{module:module||'all',fingerprint,startedAt:new Date().toISOString(),ids:selected.map(c=>c.id),results:[],completed:false};
 if(run.completed){console.log('Already completed; zero calls repeated.');process.exitCode=0;}
 else {
  state.runs[phase]=run;if(phase==='final-validation')state.validationOpened=true;
  const snapshots=dir+'/prompts/'+phase;fs.mkdirSync(snapshots,{recursive:true});
  for(const [key,file]of Object.entries(promptFiles))fs.copyFileSync(file,snapshots+'/'+key+'.js');
  save();
  for(const c of selected){
   const prior=state.attempts.find(a=>a.phase===phase&&a.id===c.id);
   if(prior){if(prior.status==='completed')continue;throw new Error('Prior unfinished attempt; no automatic paid retry:'+c.id);}
   const reservation=authorize(state.attempts,RATES[c.assistant],state.finalRemaining,final);
   const {request,provenance}=requestFor(c);
   const a={phase,id:c.id,assistant:c.assistant,model:request.model,requestHash:hash(JSON.stringify(request)),provenance,status:'counting',paidReserved:false,reservation,startedAt:new Date().toISOString()};state.attempts.push(a);save();
   try {
    const {max_tokens,thinking,...countBody}=request;
    const counted=await anthropicRequest('/v1/messages/count_tokens',countBody,process.env.ANTHROPIC_API_KEY);
    a.countedInput=counted.input_tokens;
    if(!Number.isInteger(a.countedInput)||a.countedInput<1||a.countedInput>19744)throw new Error('STOP_INPUT_CEILING');
    // Persist and fsync a conservative charge BEFORE the paid request.
    authorize(state.attempts,RATES[c.assistant],state.finalRemaining,final);
    a.paidReserved=true;a.status='paid_pending';if(final)state.finalRemaining--;save();
    const started=performance.now();
    const response=await anthropicRequest('/v1/messages',request,process.env.ANTHROPIC_API_KEY);
    a.latencyMs=Math.round(performance.now()-started);
    const u=response.usage;
    if(!u||!Number.isInteger(u.input_tokens)||!Number.isInteger(u.output_tokens)||u.input_tokens<0||u.output_tokens<0||u.input_tokens>20000||u.output_tokens>512||u.cache_creation_input_tokens||u.cache_read_input_tokens)throw new Error('STOP_UNEXPECTED_USAGE');
    a.actual={input:u.input_tokens,output:u.output_tokens,usd:(u.input_tokens*RATES[c.assistant].input+u.output_tokens*RATES[c.assistant].output)/1e6};
    a.content=response.content.map(b=>b.type==='text'?{type:b.type,text:b.text}:b.type==='tool_use'?{type:b.type,name:b.name,input:b.input}:{type:b.type});
    a.stopReason=response.stop_reason;a.score=score(c,response,request);a.status='completed';a.finishedAt=new Date().toISOString();
    run.results.push({id:c.id,assistant:c.assistant,...a.score,actual:a.actual,latencyMs:a.latencyMs,requestHash:a.requestHash});save();
    if(phase==='final-validation')console.log('Final validation response saved (sealed until completion).');
    else console.log(`${phase} ${c.id}: ${a.score.passed?'PASS':'FAIL'} critical=${a.score.critical.length} $${a.actual.usd.toFixed(6)} ${a.latencyMs}ms`);
   }catch(error){a.error=error.message;a.safeDetail=error.safeDetail;a.status='interrupted';save();throw error;}
  }
  run.completed=true;run.finishedAt=new Date().toISOString();save();
  if(phase!=='final-validation')console.log(JSON.stringify({phase,passed:run.results.filter(r=>r.passed).length,total:run.results.length,critical:run.results.filter(r=>r.critical.length).length,usage:usage(state.attempts)}));
  else console.log('Final validation complete; results may now be opened for final reporting only.');
 }
}catch(error){state.stopReason=error.message;save();console.error(error.message);process.exitCode=1;}
finally{fs.unlinkSync(lock);}

import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {anthropicRequest} from '../claude-transport.mjs';import {requestFor,RATES} from '../optimization/requests.mjs';import {evaluate} from './evaluator.mjs';import {authorize,CAPS,usage} from './budget.mjs';
const root='tools/ai-evals/revision',dir=root+'/results',file=dir+'/state.json';fs.mkdirSync(dir,{recursive:true});
const hash=v=>createHash('sha256').update(v).digest('hex');const manifest=JSON.parse(fs.readFileSync(root+'/manifest.json','utf8'));
for(const [p,h]of Object.entries(manifest.frozenFiles))if(hash(fs.readFileSync(p))!==h)throw new Error('Frozen contract changed: '+p);
const benchmark=JSON.parse(fs.readFileSync(root+'/benchmark.json','utf8')),historical=JSON.parse(fs.readFileSync('tools/ai-evals/optimization/results/state.json','utf8')),oldCases=JSON.parse(fs.readFileSync('tools/ai-evals/optimization/benchmark.json','utf8'));
const legacy=historical.runs.baseline.results.filter(r=>r.assistant==='radar'&&r.passed).map(r=>oldCases.find(c=>c.id===r.id));
const promptFiles={radar:'lib/radar-chat-prompt.js',devis:'lib/devis-chat-prompt.js',assistant:'app/api/koji-assistant/route.js'};
const originals=Object.fromEntries(Object.entries(promptFiles).map(([k,p])=>[k,spawnSync('git',['show','94c6dd4:'+p],{encoding:'utf8'}).stdout]));
for(const k of ['devis','assistant'])if(fs.readFileSync(promptFiles[k],'utf8')!==originals[k])throw new Error('Non-target application prompt changed');
const [phase]=process.argv.slice(2);if(!/^(baseline|candidate-[12]|validation-before|validation-after)$/.test(phase||''))throw new Error('Expected phase');
let s=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{base:'94c6dd4',manifest,priorUsage:usage(historical.attempts),limits:CAPS,attempts:[],runs:{},decisions:[],bestPhase:'baseline',finalRemaining:18,selectionClosed:false,validationOpened:false};
function save(){const value=JSON.stringify(s,null,2)+'\n';for(const k of ['ANTHROPIC_API_KEY','ANTHROPIC_WORKSPACE_ID'])if(process.env[k]&&value.includes(process.env[k]))throw new Error('Secret reflection');const tmp=file+'.tmp';const fd=fs.openSync(tmp,'w');try{fs.writeFileSync(fd,value);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);const d=fs.openSync(dir,'r');fs.fsyncSync(d);fs.closeSync(d);}
const final=phase.startsWith('validation');
if(!final&&s.selectionClosed)throw new Error('Selection closed; no optimization allowed');
if(phase.startsWith('candidate')){
 const n=Number(phase.slice(-1));if(!s.runs.baseline?.completed||n!==s.decisions.length+1)throw new Error('Candidate sequence prerequisite');
 if(s.decisions.length>=2||s.decisions.length>=2&&s.decisions.slice(-2).every(d=>d.retainedGain===0))throw new Error('Stagnation/iteration stop');
 const best=fs.readFileSync(dir+'/prompts/'+s.bestPhase+'/radar.js','utf8');if(fs.readFileSync(promptFiles.radar,'utf8')===best)throw new Error('No prompt change; no paid rerun allowed');
}
if(final&&!s.selectionClosed)throw new Error('Close selection before independent validation');
if(phase==='validation-before'&&fs.readFileSync(promptFiles.radar,'utf8')!==originals.radar)throw new Error('Original prompt required');
if(phase==='validation-after'){
 if(!s.runs['validation-before']?.completed)throw new Error('Original validation prerequisite');
 if(fs.readFileSync(promptFiles.radar,'utf8')!==fs.readFileSync(dir+'/prompts/'+s.bestPhase+'/radar.js','utf8'))throw new Error('Selected prompt required');
}
const selected=phase==='baseline'?benchmark.filter(c=>c.split==='dev'):final?benchmark.filter(c=>c.split==='validation'):[...benchmark.filter(c=>c.split==='dev'&&c.assistant==='radar'),...legacy];
const fingerprint=hash(Object.values(promptFiles).map(p=>fs.readFileSync(p,'utf8')).join('\n'));
if(s.runs[phase]?.fingerprint&&s.runs[phase].fingerprint!==fingerprint)throw new Error('Changed prompt during resume');
const lock=dir+'/running.lock';fs.closeSync(fs.openSync(lock,'wx'));
try{
 const env=Object.fromEntries(['PATH','HOME','TMPDIR'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
 const tests=spawnSync(process.execPath,['--test','tools/ai-evals/revision.test.mjs'],{env,encoding:'utf8',timeout:30000});if(tests.status!==0)throw new Error('Offline guards failed');
 if(!process.env.ANTHROPIC_API_KEY||!process.env.ANTHROPIC_WORKSPACE_ID)throw new Error('Missing key/workspace');
 const run=s.runs[phase]||{fingerprint,results:[],ids:selected.map(c=>c.id),completed:false};s.runs[phase]=run;
 if(run.completed)console.log('Already completed; no repeated request.');
 else{
  if(final)s.validationOpened=true;
  const snapshots=dir+'/prompts/'+phase;fs.mkdirSync(snapshots,{recursive:true});for(const[k,p]of Object.entries(promptFiles))fs.copyFileSync(p,snapshots+'/'+k+'.js');save();
  for(const c of selected){
   const prior=s.attempts.find(a=>a.phase===phase&&a.id===c.id);if(prior){if(prior.status==='completed')continue;throw new Error('Unfinished attempt; no automatic retry');}
   const reservation=authorize(s.attempts,RATES[c.assistant],s.finalRemaining,final),{request,provenance}=requestFor(c);
   const a={phase,id:c.id,assistant:c.assistant,model:request.model,requestHash:hash(JSON.stringify(request)),provenance,reservation,paidReserved:false,status:'counting'};s.attempts.push(a);save();
   try{
    const{max_tokens,thinking,...countBody}=request;const count=await anthropicRequest('/v1/messages/count_tokens',countBody,process.env.ANTHROPIC_API_KEY);a.countedInput=count.input_tokens;
    if(!Number.isInteger(a.countedInput)||a.countedInput<1||a.countedInput>19744)throw new Error('Input ceiling');
    authorize(s.attempts,RATES[c.assistant],s.finalRemaining,final);a.paidReserved=true;a.status='paid_pending';if(final)s.finalRemaining--;save();
    const start=performance.now(),response=await anthropicRequest('/v1/messages',request,process.env.ANTHROPIC_API_KEY);a.latencyMs=Math.round(performance.now()-start);
    const u=response.usage;if(!u||!Number.isInteger(u.input_tokens)||!Number.isInteger(u.output_tokens)||u.input_tokens<0||u.output_tokens<0||u.input_tokens>20000||u.output_tokens>512||u.cache_creation_input_tokens||u.cache_read_input_tokens)throw new Error('Unexpected usage');
    a.actual={input:u.input_tokens,output:u.output_tokens,usd:(u.input_tokens*RATES[c.assistant].input+u.output_tokens*RATES[c.assistant].output)/1e6};
    a.content=response.content.map(b=>b.type==='text'?{type:b.type,text:b.text}:b.type==='tool_use'?{type:b.type,name:b.name,input:b.input}:{type:b.type});a.stopReason=response.stop_reason;a.score=evaluate(c,response,request);a.status='completed';
    run.results.push({id:a.id,assistant:a.assistant,...a.score,actual:a.actual,latencyMs:a.latencyMs});save();
    console.log(final?'Independent validation response sealed.':`${phase} ${c.id}: ${a.score.passed?'PASS':'FAIL'} critical=${a.score.critical.length} $${a.actual.usd.toFixed(6)}`);
   }catch(e){a.status='interrupted';a.error=e.message;save();throw e;}
  }
  run.completed=true;save();if(final)console.log(phase==='validation-after'?'Paired validation complete; may now inspect results.':'Before validation complete; keep results sealed until after phase.');else console.log(JSON.stringify({phase,passed:run.results.filter(r=>r.passed).length,total:run.results.length,usage:usage(s.attempts)}));
 }
}catch(e){s.stopReason=e.message;save();console.error(e.message);process.exitCode=1;}finally{fs.unlinkSync(lock);}

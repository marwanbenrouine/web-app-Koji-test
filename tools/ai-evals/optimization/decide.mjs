import fs from 'node:fs';
import {compareRuns} from './selection.mjs';
const dir='tools/ai-evals/optimization/results',file=dir+'/state.json';
if(fs.existsSync(dir+'/running.lock'))throw new Error('Run active');
const state=JSON.parse(fs.readFileSync(file,'utf8'));
const [phase,hypothesis]=process.argv.slice(2),candidate=state.runs[phase];
if(!candidate?.completed||!phase.startsWith('iter-')||state.validationOpened||state.runs['final-dev'])throw new Error('No completed iteration to decide');
if(state.iterations.some(i=>i.phase===phase))throw new Error('Already decided');
const module=candidate.module,previousPhase=state.best[module];
const comparison=compareRuns(state.runs[previousPhase],candidate,module);
const noChange=fs.readFileSync(dir+'/prompts/'+previousPhase+'/'+module+'.js','utf8')===fs.readFileSync(dir+'/prompts/'+phase+'/'+module+'.js','utf8');
const accepted=comparison.accept&&!noChange;
const decision={iteration:state.iterations.length+1,phase,module,previousPhase,hypothesis,...comparison,observedGainPp:comparison.gainPp,gainPp:accepted?comparison.gainPp:0,accept:accepted,noChange,decidedAt:new Date().toISOString()};
state.iterations.push(decision);
if(decision.accept)state.best[module]=phase;
else {
 const files={radar:'lib/radar-chat-prompt.js',devis:'lib/devis-chat-prompt.js',assistant:'app/api/koji-assistant/route.js'};
 fs.copyFileSync(dir+'/prompts/'+previousPhase+'/'+module+'.js',files[module]);
}
const tmp=file+'.tmp',fd=fs.openSync(tmp,'w');fs.writeFileSync(fd,JSON.stringify(state,null,2)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fs.renameSync(tmp,file);
console.log(JSON.stringify(decision,null,2));

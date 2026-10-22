import fs from 'node:fs';
import {evaluate} from './evaluator.mjs';
import {requestFor} from '../optimization/requests.mjs';
const root='tools/ai-evals/revision';fs.mkdirSync(root+'/results',{recursive:true});
const old=JSON.parse(fs.readFileSync('tools/ai-evals/optimization/results/state.json','utf8'));
const cases=JSON.parse(fs.readFileSync('tools/ai-evals/optimization/benchmark.json','utf8'));
const rows=old.attempts.map(a=>{
 const c=cases.find(c=>c.id===a.id),r=evaluate(c,{content:a.content,stop_reason:a.stopReason},requestFor(c).request);
 return {phase:a.phase,id:a.id,assistant:a.assistant,originalPassed:a.score.passed,consumerPassed:r.passed,originalIssues:a.score.issues,consumerIssues:r.issues,presentation:r.presentation,critical:r.critical,actual:a.actual,latencyMs:a.latencyMs,cause:r.passed&&!a.score.passed?'Presentation preference, accepted by real parseAiJson':r.issues.map(i=>i.reason.startsWith('schema:')||i.reason==='truncated'?'Generation truncation/schema':i.reason.startsWith('record_missing')?'Recording completeness or overly specific field mapping':i.reason.includes('question')?'Prompt question/choice discipline':'Semantic/argument criterion').join('; ')||'No detected failure'};
});
fs.writeFileSync(root+'/results/historical-audit.json',JSON.stringify(rows,null,2)+'\n');
let md='# Audit hors ligne des réponses historiques\n\nLe parseur réel est appliqué sans changer les attentes ni les réponses. Les scores originaux restent intacts. Chaque réponse facturée est listée, y compris variantes rejetées et contrôles.\n\n| Phase | Cas | Ancien | Consommateur | Cause / échecs persistants |\n| --- | --- | --- | --- | --- |\n';
for(const r of rows)md+=`| ${r.phase} | ${r.id} | ${r.originalPassed?'OK':'échec'} | ${r.consumerPassed?'OK':'échec'} | ${r.consumerIssues.map(i=>i.reason).join('; ')||r.cause} |\n`;
md+='\nR-D08 : exiger précisément etat peut refuser cadragePrecisions, pourtant pertinent pour les fissures selon le prompt. Cette restriction reste inchangée dans le rejeu historique et est signalée comme limite du benchmark. Les nouveaux critères ne changent pas après les appels.\n\nA-V05 historique : une clarification sur l’adresse est demandée alors que le client et la description suffisent selon le prompt ; cette erreur était absente du barème historique. Un nouveau cas de développement la contrôle désormais avant tout appel, sans réécrire le score historique.\n';
fs.writeFileSync(root+'/AUDIT.md',md);
for(const phase of ['baseline','final-dev','final-validation'])for(const module of ['radar','devis','assistant']){const a=rows.filter(r=>r.phase===phase&&r.assistant===module);console.log(JSON.stringify({phase,module,old:a.filter(r=>r.originalPassed).length,consumer:a.filter(r=>r.consumerPassed).length,total:a.length}));}

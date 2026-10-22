import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {CAPS,usage,authorize} from './optimization/budget.mjs';
import {requestFor} from './optimization/requests.mjs';
import {score,schemaIssues} from './optimization/score.mjs';
import {CASES} from './campaign.mjs';
const path=new URL('./optimization/benchmark.json',import.meta.url),raw=fs.readFileSync(path,'utf8'),cases=JSON.parse(raw);
test('45 frozen synthetic scenarios, 30 dev/15 validation, balanced across modules and original cases retained',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('./optimization/manifest.json',import.meta.url),'utf8'));
 assert.equal(createHash('sha256').update(raw).digest('hex'),manifest.benchmarkSha256);
 assert.equal(cases.length,45);assert.equal(new Set(cases.map(c=>c.id)).size,45);
 for(const a of ['radar','devis','assistant']){assert.equal(cases.filter(c=>c.assistant===a&&c.split==='dev').length,10);assert.equal(cases.filter(c=>c.assistant===a&&c.split==='validation').length,5);}
 for(const c of CASES)assert.equal(cases.find(x=>x.id===c.id).message,c.message);
 assert.ok(cases.every(c=>Object.keys(c.expect).length));
});
test('persistent pending attempts charged conservatively; completed response releases only unused reservation',()=>{
 const r=authorize([],{input:2,output:10},45,false);
 assert.equal(r.input,20000);assert.equal(r.output,512);assert.equal(r.usd,.04512);
 const attempts=[{paidReserved:true,reservation:r}];assert.equal(usage(attempts).usd,.04512);
 attempts[0].actual={usd:.01,input:3000,output:100};assert.equal(usage(attempts).usd,.01);
});
test('cumulative dollar/input/output/call ceilings and reserved finals fail closed',()=>{
 const attempt=actual=>[{paidReserved:true,actual,reservation:actual}];
 assert.throws(()=>authorize(attempt({usd:4.99,input:0,output:0}),{input:2,output:10},45),/usd/);
 assert.throws(()=>authorize(attempt({usd:0,input:600001,output:0}),{input:2,output:10},45),/input/);
 assert.throws(()=>authorize(attempt({usd:0,input:0,output:79999}),{input:2,output:10},0),/output/);
 assert.throws(()=>authorize(Array.from({length:150},()=>({paidReserved:true,actual:{usd:0,input:0,output:0},reservation:{usd:0,input:0,output:0}})),{input:1,output:5},0),/generations/);
 assert.doesNotThrow(()=>authorize([],{input:2,output:10},45));
 assert.equal(CAPS.iterations,8);
});
test('request construction reuses live source without data/tool execution and fixes model/parameters',()=>{
 for(const id of ['LIVE-RADAR-01','LIVE-DEVIS-02','LIVE-ASSISTANT-01','A-D10','R-D03']){
  const c=cases.find(c=>c.id===id),{request,provenance}=requestFor(c);
  assert.equal(request.max_tokens,512);assert.equal(request.thinking.type,'disabled');
  assert.ok(provenance.length>=8);assert.ok(!JSON.stringify(request).includes('definir_consigne_permanente'));
  for(const b of Array.isArray(request.system)?request.system:[])assert.equal(b.cache_control,undefined);
 }
});
test('recursive JSON schema validates required fields, types, enums and nested arrays',()=>{
 const schema={type:'object',required:['v'],properties:{v:{type:'array',items:{type:'object',required:['n'],properties:{n:{type:'number'}}}}}};
 assert.deepEqual(schemaIssues({v:[{n:2}]},schema),[]);assert.ok(schemaIssues({v:[{n:'x'}]},schema).length);assert.ok(schemaIssues({},schema).length);
});
test('wrong quantity/target/unrequested action/invented price are critical, not scoreable successes',()=>{
 const c=cases.find(c=>c.id==='LIVE-DEVIS-02'),{request}=requestFor(c);
 for(const tool of [{name:'modifier_ouvrage',input:{id:'synthetic-line',quantite:13}},{name:'modifier_ouvrage',input:{id:'other',quantite:12}},{name:'ajouter_ouvrage',input:{designation:'x',quantite:12,lot:'Peinture'}},{name:'modifier_ouvrage',input:{id:'synthetic-line',quantite:12,prixUnitaireHt:50}}]){
  const s=score(c,{content:[{type:'tool_use',...tool}],stop_reason:'tool_use'},request);assert.ok(s.critical.length);assert.equal(s.passed,false);
 }
 const s=score(c,{content:[{type:'tool_use',name:'modifier_ouvrage',input:{id:'synthetic-line',quantite:12}}],stop_reason:'tool_use'},request);assert.equal(s.passed,true);
});
test('Radar recording completeness and duplicated choice question are independent dimensions',()=>{
 const c=cases.find(c=>c.id==='LIVE-RADAR-02'),{request}=requestFor(c);
 const s=score(c,{content:[{type:'text',text:'Quel projet ?'},{type:'tool_use',name:'proposer_choix',input:{question:'Quel projet ?',options:['A','B'],multiple:false}}],stop_reason:'tool_use'},request);
 assert.equal(s.dimensions.completeness,0);assert.equal(s.dimensions.clarity,0);assert.equal(s.passed,false);
});
test('strict JSON format and underlying assistant action evaluated separately; wrong action critical',()=>{
 const c=cases.find(c=>c.id==='LIVE-ASSISTANT-01'),{request}=requestFor(c);
 const value={action:'navigate',type:'autre',fields:{page:'calendrier'},detectedFromPhoto:false,needsClarification:false,clarifyingQuestion:null,quickReplies:[]};
 const s=score(c,{content:[{type:'text',text:'```json\n'+JSON.stringify(value)+'\n```'}]},request);assert.equal(s.dimensions.format,0);assert.equal(s.dimensions.accuracy,1);assert.equal(s.critical.length,0);
 value.action='delete';assert.ok(score(c,{content:[{type:'text',text:JSON.stringify(value)}]},request).critical.length);
});

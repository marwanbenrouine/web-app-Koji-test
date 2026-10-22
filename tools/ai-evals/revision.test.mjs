import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {evaluate,parseForConsumer} from './revision/evaluator.mjs';import {authorize,CAPS,usage} from './revision/budget.mjs';import {requestFor} from './optimization/requests.mjs';
const c={assistant:'assistant',message:'Ouvre le calendrier.',expect:{json:{action:'navigate','fields.page':'calendrier'},maxTextChars:1600}};
const req=requestFor(c).request,body={action:'navigate',type:'autre',fields:{page:'calendrier'},needsClarification:false,detectedFromPhoto:false,clarifyingQuestion:null,quickReplies:[]};
const response=text=>({content:[{type:'text',text}],stop_reason:'end_turn'});
test('Assistant uses actual Koji parser: bare and fenced JSON both consumer-valid; preference retained',()=>{
 for(const text of [JSON.stringify(body),'```json\n'+JSON.stringify(body)+'\n```']){const r=evaluate(c,response(text),req);assert.equal(r.passed,true);assert.equal(r.consumer.schemaValid,true);}
 const r=evaluate(c,response('```json\n'+JSON.stringify(body)+'\n```'),req);assert.equal(r.presentation.rawJson,false);assert.ok(r.presentation.warnings.length);
});
test('consumer rejects preamble, malformed JSON, arrays and wrong field schema',()=>{
 for(const text of ['Here is JSON: '+JSON.stringify(body),'```json\n{invalid}\n```','null','[]',JSON.stringify({...body,fields:null})])assert.equal(evaluate(c,response(text),req).passed,false);
 assert.throws(()=>parseForConsumer('prefix '+JSON.stringify(body)));
});
test('wrong intent/target/amount, schema and clarification remain failures despite valid parser',()=>{
 for(const bad of [{...body,action:'delete'},{...body,fields:{page:'devis'}},{...body,quickReplies:'bad'}])assert.equal(evaluate(c,response('```json\n'+JSON.stringify(bad)+'\n```'),req).passed,false);
 const cc={...c,expect:{json:{action:'create',type:'depense','fields.amount':63,needsClarification:false}}};const value={...body,action:'create',type:'depense',fields:{amount:64},needsClarification:true};assert.ok(evaluate(cc,response(JSON.stringify(value)),req).critical.length);
});
test('Radar criteria and Devis original successes are not weakened by Assistant normalization',()=>{
 const old=JSON.parse(fs.readFileSync('tools/ai-evals/optimization/results/state.json','utf8')),cases=JSON.parse(fs.readFileSync('tools/ai-evals/optimization/benchmark.json','utf8'));
 for(const a of old.attempts.filter(a=>a.phase==='baseline'&&a.assistant!=='assistant')){const cc=cases.find(c=>c.id===a.id),r=evaluate(cc,{content:a.content,stop_reason:a.stopReason},requestFor(cc).request);assert.equal(r.passed,a.score.passed);}
});
test('remaining budget enforces cumulative 150 generations and reserves 18 independent comparisons',()=>{
 assert.equal(CAPS.generations+105,150);assert.equal(CAPS.input+648879,1500000);
 assert.throws(()=>authorize([{paidReserved:true,actual:{usd:3.60,input:0,output:0}}],{input:2,output:10}),/usd/);
 const a=Array.from({length:27},()=>({paidReserved:true,actual:{usd:0,input:0,output:0}}));assert.throws(()=>authorize(a,{input:1,output:5}),/generations/);
 assert.equal(authorize([],{input:2,output:10}).usd,.04512);assert.equal(usage([{paidReserved:true,reservation:{usd:.04512,input:20000,output:512}}]).usd,.04512);
});

test('new scenarios and scorer frozen before calls; validation is distinct and module-balanced',async()=>{
 const {createHash}=await import('node:crypto');const m=JSON.parse(fs.readFileSync('tools/ai-evals/revision/manifest.json','utf8'));
 for(const[p,h]of Object.entries(m.frozenFiles))assert.equal(createHash('sha256').update(fs.readFileSync(p)).digest('hex'),h);
 const cases=JSON.parse(fs.readFileSync('tools/ai-evals/revision/benchmark.json','utf8'));
 assert.equal(cases.length,18);assert.equal(new Set(cases.map(c=>c.id)).size,18);
 for(const a of ['radar','devis','assistant'])for(const split of ['dev','validation'])assert.equal(cases.filter(c=>c.assistant===a&&c.split===split).length,3);
});

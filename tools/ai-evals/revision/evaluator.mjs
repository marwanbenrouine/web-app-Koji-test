import fs from 'node:fs';
import vm from 'node:vm';
import { score as legacyScore, DIMENSIONS } from '../optimization/score.mjs';
// Evaluate the exact pure parser source; do not import application routes/DB modules.
const parserSource=fs.readFileSync(new URL('../../../lib/ai-json.js',import.meta.url),'utf8');
const parseAiJson=vm.runInNewContext(parserSource.replace(/^export /gm,'')+'\nparseAiJson',{}, {timeout:1000});
export function parseForConsumer(text){return parseAiJson(text);}
export function evaluate(c,response,request){
 if(c.assistant!=='assistant')return {...legacyScore(c,response,request),presentation:{rawJson:null,warnings:[]}};
 const text=Array.isArray(response.content)?response.content.filter(b=>b.type==='text').map(b=>b.text).join('\n'):'';
 let body,rawJson=true;
 try{JSON.parse(text);}catch{rawJson=false;}
 try{body=parseAiJson(text);}catch{
  const old=legacyScore(c,response,request);
  return {...old,passed:false,presentation:{rawJson,warnings:[]},consumer:{parsed:false,schemaValid:false}};
 }
 if(!body||typeof body!=='object'||Array.isArray(body))return {passed:false,issues:[{dimension:'format',reason:'consumer_object_required'}],critical:[],dimensions:Object.fromEntries(DIMENSIONS.map(d=>[d,d==='format'?0:1])),consumer:{parsed:true,schemaValid:false},presentation:{rawJson,warnings:[]}};
 const normalized={...response,content:[{type:'text',text:JSON.stringify(body)},...response.content.filter(b=>b.type!=='text')]};
 const result=legacyScore(c,normalized,request);
 if(!body.fields||typeof body.fields!=='object'||Array.isArray(body.fields)){
  result.issues.push({dimension:'format',reason:'consumer_fields_object_required'});result.dimensions.format=0;result.passed=false;
 }
 return {...result,consumer:{parsed:true,schemaValid:result.dimensions.format===1},presentation:{rawJson,warnings:rawJson?[]:['markdown_accepted_by_real_parser_not_raw_json']}};
}

import { loadPrompts } from '../prompt-source.mjs';
export const MODELS = { radar: 'claude-sonnet-5', devis: 'claude-sonnet-5', assistant: 'claude-haiku-4-5-20251001' };
export const RATES = { radar:{input:2,output:10}, devis:{input:2,output:10}, assistant:{input:1,output:5} };
export function requestFor(c) {
  const {api,provenance}=loadPrompts();
  const db={aiAssistantInstructions:{radar:'',devisChat:'',kojiAssistant:''}};
  let system,tools,messages;
  if(c.assistant==='radar') { system=api.buildRadarSystemPrompt({draft:c.draft||{data:{}},prenom:'Test',db,isAdmin:false}); tools=api.RADAR_TOOLS; }
  if(c.assistant==='devis') { system=api.buildDevisChatPrompt({quoteSnapshot:c.snapshot||{},db,isAdmin:false});tools=api.DEVIS_CHAT_TOOLS; }
  if(c.assistant==='assistant') {
    system="Tu es l'assistant koji du dashboard entreprise. Tu réponds uniquement en JSON strict, sans aucun texte ni balise markdown autour.";
    const text=api.buildPrompt({today:'2026-10-22',message:c.message,isSecondRound:false,hasPhotos:false,onDevisPage:c.onDevisPage||false,db,...c.conversation});
    messages=[{role:'user',content:text}];
  } else messages=(c.turns||[{role:'user',text:c.message}]).map(t=>({role:t.role,content:t.text}));
  system=typeof system==='string'?system:system.map(({cache_control,...b})=>b);
  return { request:JSON.parse(JSON.stringify({model:MODELS[c.assistant],system,...(tools?{tools}:{}),messages,max_tokens:512,thinking:{type:'disabled'}})), provenance };
}

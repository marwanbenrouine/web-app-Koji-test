// Extract named declarations only: never import application routes or DB modules.
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const root = new URL('../../', import.meta.url);
const sources = [];
function select(path, names = null) {
  const source = readFileSync(new URL(path, root), 'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const nodes = ast.statements.filter(n => !ts.isImportDeclaration(n) && (
    ts.isFunctionDeclaration(n) || ts.isVariableStatement(n)
  ));
  const selected = names ? names.map(name => {
    const node = nodes.find(n => n.name?.text === name || n.declarationList?.declarations.some(d => d.name.text === name));
    if (!node) throw new Error(`Missing prompt declaration: ${path}:${name}`);
    return node;
  }) : nodes;
  sources.push({ path, sha256: createHash('sha256').update(source).digest('hex') });
  return selected.map(n => n.getText(ast).replace(/^export\s+/, '')).join('\n');
}
export function loadPrompts() {
  sources.length = 0;
  const script = [
    select('lib/renovation-question-bank.js'), select('lib/text.js'),
    select('lib/ai-assistant-instructions.js', ['ASSISTANT_KEYS', 'getAssistantInstruction', 'adminInstructionBlock']),
    select('lib/radar-chat-prompt.js'), select('lib/devis-chat-prompt.js'),
    select('lib/radar-assistant-tools.js', ['RADAR_TOOLS']),
    select('lib/devis-chat-tools.js', ['DEVIS_CHAT_TOOLS']),
    select('lib/koji-assistant-tools.js', ['PAGES']),
    select('app/api/koji-assistant/route.js', ['TYPE_FIELD_SPECS', 'buildPrompt']),
    '({ buildRadarSystemPrompt, buildDevisChatPrompt, buildPrompt, RADAR_TOOLS, DEVIS_CHAT_TOOLS, PAGES })'
  ].join('\n');
  const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
  const api = new vm.Script(script).runInContext(context, { timeout: 1000 });
  // No process, require, fetch, file IO, timers or route executors in this context.
  return { api, provenance: [...sources] };
}

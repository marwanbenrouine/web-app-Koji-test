import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCampaign, LIMITS, reserve, priceReservation, assess } from './campaign.mjs';
import { anthropicRequest } from './claude-transport.mjs';

test('real prompt extraction produces exactly five synthetic cases without application imports', () => {
  const { cases, provenance } = buildCampaign();
  assert.equal(cases.length, 5);
  assert.deepEqual(cases.map(c => c.assistant), ['radar', 'radar', 'devis', 'devis', 'assistant']);
  assert.ok(provenance.some(p => p.path === 'app/api/koji-assistant/route.js'));
  for (const c of cases) {
    assert.equal(c.request.max_tokens, 512);
    assert.ok(JSON.stringify(c.request).length > 1000);
    assert.ok(!JSON.stringify(c.request).includes('definir_consigne_permanente'));
    for (const b of Array.isArray(c.request.system) ? c.request.system : []) assert.equal(b.cache_control, undefined);
  }
  assert.match(cases[3].request.system.map(b => b.text).join(''), /synthetic-line/);
});

test('five paid attempts ceiling reserves before sending', () => {
  const state = { messages: 0, reservedUsd: 0 };
  for (let i = 0; i < 5; i++) reserve(state, 100, { input: 1, output: 5 });
  assert.throws(() => reserve(state, 100, { input: 1, output: 5 }), /ceiling/);
  assert.equal(state.messages, LIMITS.messages);
});

test('budget is worst-case output reservation and cannot exceed one USD', () => {
  const state = { messages: 0, reservedUsd: 0.99 };
  assert.throws(() => reserve(state, 20000, { input: 100, output: 100 }), /budget/);
  assert.equal(state.messages, 0);
  assert.equal(state.reservedUsd, 0.99);
  assert.equal(priceReservation(1000, { input: 3, output: 15 }), (3000+512*15)/1e6);
});

test('reject unknown/non-finite pricing, token overflows and malformed counts', () => {
  for (const value of [0, -1, NaN, Infinity, 20001, 1.5]) assert.throws(() => priceReservation(value, { input: 1, output: 5 }));
  for (const rates of [null, {}, { input: 0, output: 5 }, { input: 1, output: Infinity }, { input: 1, output: 101 }]) assert.throws(() => priceReservation(10, rates));
});

test('reject production/custom destinations before transport, even with a dummy key', () => {
  assert.throws(() => anthropicRequest('https://kojibuild.com', {}, 'synthetic'), /Forbidden/);
  assert.throws(() => anthropicRequest('/v1/messages', {}, ''), /Missing/);
  assert.throws(() => anthropicRequest('/v1/messages', {}, 'bad\nheader'), /invalid/);
});

test('grade invalid JSON, wrong actions, invented price, truncation and duplicate lines', () => {
  const { cases } = buildCampaign();
  const response = content => ({ content, stop_reason: 'end_turn' });
  const text = value => ({ type: 'text', text: value });
  assert.equal(assess(cases[4], response([text('not json')])).passed, false);
  assert.equal(assess(cases[4], response([text('{"action":"navigate","fields":{"page":"calendrier"}}')])).passed, true);
  assert.equal(assess(cases[1], response([text('Le prix ferme est 5000 euros')])).passed, false);
  assert.equal(assess(cases[0], { ...response([text('Quelle pièce ?')]), stop_reason: 'max_tokens' }).passed, false);
  assert.equal(assess(cases[3], response([{ type: 'tool_use', name: 'ajouter_ouvrage', input: {} }])).passed, false);
  assert.equal(assess(cases[3], response([{ type: 'tool_use', name: 'modifier_ouvrage', input: { id: 'synthetic-line', quantite: 12 } }])).passed, true);
  assert.equal(assess(cases[0], response([{ type: 'tool_use', name: 'enregistrer_info', input: { champ: 'cotes', valeur: '20m2' } }])).passed, false);
});

test('transport and runner have no retries, redirects, custom URL or application execution', () => {
  const transport = readFileSync(new URL('./claude-transport.mjs', import.meta.url), 'utf8');
  assert.ok(transport.includes('https://api.anthropic.com'));
  assert.ok(transport.includes('retry = "0"'));
  assert.ok(!transport.includes('location ='));
  const runner = readFileSync(new URL('./live-campaign.mjs', import.meta.url), 'utf8');
  assert.ok(runner.indexOf("checks.status !== 0") < runner.indexOf("await send('/v1/messages'"));
  assert.ok(!runner.includes('executeRadarTool'));
  assert.ok(!runner.includes('executeDevisChatTool'));
});

test('full campaign reservations fail closed before generation when aggregate budget is too high', () => {
  const state = { messages: 0, reservedUsd: 0 };
  const prepared = [];
  let generated = 0;
  assert.throws(() => {
    for (const c of buildCampaign().cases) prepared.push({ c, reservation: reserve(state, 20000, { input: 20, output: 100 }) });
    // Same all-reservations-before-generation policy used in live runner.
    for (const c of prepared) generated++;
  }, /ceiling/);
  assert.equal(generated, 0);
  assert.ok(state.reservedUsd <= 1);
});

test('sanitized HTTP diagnostics never include provider messages or credential echoes', async () => {
  const { decodeResponse } = await import('./claude-transport.mjs');
  assert.throws(() => decodeResponse('{"error":{"type":"authentication_error","message":"sensitive-echo"}}\n401', 22), /Anthropic HTTP 401 \(authentication_error\)/);
  try { decodeResponse('{"error":{"type":"authentication_error","message":"sensitive-echo"}}\n401', 22); } catch (e) { assert.ok(!e.message.includes('sensitive-echo')); }
  assert.deepEqual(decodeResponse('{"content":[]}\n200', 0), { content: [] });
  assert.throws(() => decodeResponse('', 28), /curl 28/);
});

test('verified campaign rates reserve all input/output ceilings within one dollar', () => {
  const state = { messages: 0, reservedUsd: 0 };
  for (const c of buildCampaign().cases) reserve(state, LIMITS.inputTokens, c.assistant === 'assistant' ? { input: 1, output: 5 } : { input: 2, output: 10 });
  assert.equal(state.messages, 5);
  assert.ok(Math.abs(state.reservedUsd - 0.20304) < 1e-9);
});

test('report handles pending, interrupted, completed and unrun cases without losing the ledger', async () => {
  const { markdownReport } = await import('./campaign-report.mjs');
  const report = { paidAttempts: 0, requests: 0, reservedUsd: 0.20304, scenarios: [{ id: 'pending' }, { id: 'unrun' }], results: [{ id: 'pending', phase: 'count_tokens', passed: false }] };
  assert.match(markdownReport(report), /count_tokens/);
  assert.match(markdownReport(report), /not executed/);
  report.results[0] = { id: 'pending', phase: 'completed', passed: true, inputTokens: 50, outputTokens: 10, estimatedCostUsd: 0.0002, durationMs: 500, issues: [] };
  assert.match(markdownReport(report), /checks passed/);
  assert.match(markdownReport(report), /50\/10/);
});

test('workspace header is optional, explicit and rejects header injection', async () => {
  const { workspaceHeader, decodeResponse } = await import('./claude-transport.mjs');
  assert.deepEqual(workspaceHeader(undefined), []);
  assert.deepEqual(workspaceHeader('wrkspc_synthetic'), ['header = "anthropic-workspace-id: wrkspc_synthetic"']);
  assert.throws(() => workspaceHeader('bad\r\nx-api-key: injected'), /Invalid/);
  try { decodeResponse('{"error":{"type":"invalid_request_error","message":"echo synthetic-key"}}\n400', 22, false, 'synthetic-key'); }
  catch(e) { assert.equal(e.safeDetail, 'echo [REDACTED]'); }
});

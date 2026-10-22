import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { ASSISTANT_ROUTES, buildRequestPayload, normalizeResponse, grade } from './core.mjs';

// Synthetic wire responses: no route imports, database, authentication or model.
for (const [assistant, wire, expect] of [
  ['radar', 'event: delta\ndata: {"text":"Quelle surface ?"}\n\nevent: choice\ndata: {"options":["Cuisine","Salon"]}\n\nevent: photo-request\ndata: {"sujet":"cuisine"}\n\nevent: done\ndata: {"finished":false,"draftId":"synthetic-draft"}\n\n', { eventsInclude: ['delta', 'choice', 'photo-request', 'done'], finished: false }],
  ['devisChat', 'event: action\ndata: {"subAction":"updateOuvrage","id":"synthetic-line"}\n\nevent: done\ndata: {"finished":true}\n\n', { eventsInclude: ['action', 'done'], actionsInclude: ['updateOuvrage'], actionsExclude: ['addOuvrage'], finished: true }],
  ['kojiAssistant', '{"outcome":"navigate","path":"/calendrier","message":"Calendrier"}', { outcome: 'navigate', path: '/calendrier' }]
]) {
  test(`offline smoke: ${assistant} request and response contract`, async () => {
    const scenario = { assistant, input: { message: 'Demande synthétique' }, expect };
    const payload = buildRequestPayload(scenario, 'synthetic-conversation');
    if (assistant === 'kojiAssistant') assert.equal(payload.message, scenario.input.message);
    else assert.deepEqual(payload.turns, [{ role: 'user', text: scenario.input.message }]);
    const result = normalizeResponse(scenario, 200, wire);
    assert.deepEqual(grade(scenario, result), { passed: true, issues: [] });
    assert.equal(grade(scenario, normalizeResponse(scenario, 500, wire)).passed, false);
    // Confirm the expected route is still present and declares POST, without executing it.
    const route = await readFile(new URL(`../../${ASSISTANT_ROUTES[assistant].slice(1).replace(/^api\//, 'app/api/')}/route.js`, import.meta.url), 'utf8');
    assert.match(route, /export async function POST\(/);
  });
}

test('offline CLI smoke lists four scenarios with fetch forbidden', () => {
  const runner = new URL('./run.mjs', import.meta.url).href;
  const code = `globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); }; process.argv = ['node', 'run.mjs', '--suite', 'smoke']; await import(${JSON.stringify(runner)});`;
  // Only basic OS variables; no inherited API keys or database credentials.
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'SystemRoot'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /4 scenarios/);
  for (const id of ['RADAR-001', 'DEVIS-001', 'PRO-001', 'PRO-002']) assert.ok(result.stdout.includes(id));
  assert.doesNotMatch(result.stderr, /NETWORK_FORBIDDEN/);
});

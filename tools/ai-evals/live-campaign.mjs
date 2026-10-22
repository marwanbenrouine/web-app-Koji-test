#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildCampaign, LIMITS, reserve, assess } from './campaign.mjs';
import { anthropicRequest } from './claude-transport.mjs';

async function main() {
  const argv = process.argv.slice(2);
  if (argv.some(a => a !== '--live')) throw new Error('Only --live is supported; ceilings cannot be overridden');
  const plan = buildCampaign();
  const report = { mode: argv.includes('--live') ? 'live' : 'preflight', limits: LIMITS, provenance: plan.provenance, scenarios: plan.cases.map(({ id, assistant, request }) => ({ id, assistant, model: request.model })), results: [], reservedUsd: 0, requests: 0, paidAttempts: 0 };
  const baseDir = resolve('tmp/koji-ai-live');
  const dir = resolve(baseDir, 'run-' + randomUUID());
  await mkdir(dir, { recursive: true });
  const save = async () => { await writeFile(resolve(dir, 'report.json'), JSON.stringify(report, null, 2)+'\n');
    await writeFile(resolve(dir, 'report.md'), ['# KOJI synthetic prompt campaign', '', `Status: ${report.status || 'in_progress'}`, `Paid attempts: ${report.paidAttempts}/5; HTTP requests: ${report.requests}/10`, `Reserved budget: ${report.reservedUsd} USD (ceiling 1 USD, depends on verified rates)`, '', '| Scenario | Result | Latency ms | Issues |', '| --- | --- | ---: | --- |', ...report.scenarios.map(c => { const r = report.results.find(r => r.id === c.id); return `| ${c.id} | ${r ? (r.passed ? 'checks passed; review required' : 'failed') : 'not executed'} | ${r?.durationMs ?? '-'} | ${r?.issues.join(', ') || '-'} |`; }), '', 'Synthetic single-turn prompt tests only. No database, tool execution, app routes or UI protocol exercised. Human review remains necessary for hallucinations.', ''].join('\n'));  };
  // Rerun actual safety assertions in a sanitized child BEFORE any network request.
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  const checks = spawnSync(process.execPath, ['--test', 'tools/ai-evals/campaign.test.mjs'], { env, encoding: 'utf8', timeout: 30000 });
  if (checks.status !== 0) throw new Error('Offline safety tests failed; no network allowed');
  report.safetyTests = 'passed';
  if (!argv.includes('--live')) { report.status = 'prepared_not_executed'; await save(); console.log('Preflight passed: 5 synthetic cases; zero network requests.'); return; }
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing');
    // No invented model pricing. User/operator must verify official rates for exact model IDs.
    const pricing = JSON.parse(await readFile('tools/ai-evals/pricing.json', 'utf8'));
    const age = Date.now() - Date.parse(pricing.verifiedAt);
    if (pricing.source !== 'https://platform.claude.com/docs/en/about-claude/pricing' || !Number.isFinite(age) || age < 0 || age > 7*86400000) throw new Error('Current official pricing verification required');
    // A retained lock prevents accidental concurrent or repeated paid campaigns.
    // Keep it even after errors/timeouts; an operator must inspect the report first.
    await mkdir(resolve(baseDir, 'live.lock'));
    await writeFile(resolve(baseDir, 'live.lock/report-path.txt'), dir + '\n');
    const state = { messages: 0, reservedUsd: 0 };
    const requests = [];
    for (const c of plan.cases) {
      const rates = pricing.models?.[c.request.model];
      // Validate all model rates before even the non-generating count requests.
      reserve({ messages: 0, reservedUsd: 0 }, 1, rates);
    }
    const send = async (path, body) => {
      if (report.requests >= LIMITS.requests) throw new Error('HTTP request ceiling');
      report.requests++; await save();
      return anthropicRequest(path, body, process.env.ANTHROPIC_API_KEY);
    };
    // Count and reserve ALL requests first. No paid request if any model/budget check fails.
    for (const c of plan.cases) {
      const { max_tokens, thinking, ...countBody } = c.request;
      const counted = await send('/v1/messages/count_tokens', countBody);
      const rates = pricing.models?.[c.request.model];
      const reservation = reserve(state, counted.input_tokens, rates);
      requests.push({ c, inputTokens: counted.input_tokens, reservation, rates });
    }
    report.reservedUsd = state.reservedUsd;
    report.pricing = pricing; await save();
    for (const { c, inputTokens, reservation } of requests) {
      report.paidAttempts++; await save(); // Reserve before sending, including ambiguous timeouts.
      const started = performance.now();
      const response = await send('/v1/messages', c.request);
      const grade = assess(c, response);
      const usage = response.usage;
      if (!usage || usage.input_tokens > inputTokens || usage.output_tokens > LIMITS.outputTokens || usage.cache_creation_input_tokens || usage.cache_read_input_tokens) throw new Error('Unexpected usage; campaign stopped');
      // Store synthetic outputs for manual review, never complete provider bodies or headers.
      const content = response.content.map(b => b.type === 'text' ? { type: b.type, text: b.text } : b.type === 'tool_use' ? { type: b.type, name: b.name, input: b.input } : { type: b.type });
      if (JSON.stringify(content).includes(process.env.ANTHROPIC_API_KEY)) throw new Error('Secret reflection blocked');
      report.results.push({ id: c.id, ...grade, durationMs: Math.round(performance.now()-started), inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, reservedUsd: reservation, content });
      await save();
    }
    report.status = report.results.every(r => r.passed) ? 'checks_passed_human_review_required' : 'functional_failures';
    if (report.results.some(r => !r.passed)) process.exitCode = 1;
  } catch (error) {
    // Only our sanitized error messages are exposed, never arbitrary API errors.
    report.status = 'blocked_or_interrupted'; report.error = error.code === 'ENOENT' ? 'Verified pricing file missing' : error.code === 'EEXIST' ? 'Existing campaign lock; inspect prior report before another campaign' : error instanceof SyntaxError ? 'Invalid pricing or response JSON' : error.message;
    process.exitCode = 1;
  }
  await save(); console.log(`Campaign: ${report.status}; paid attempts: ${report.paidAttempts}. See ${dir}/report.json`);
}
main().catch(() => { console.error('Campaign preflight failed; no further request sent.'); process.exitCode = 1; });

#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildCampaign, LIMITS, reserve, assess } from './campaign.mjs';
import { anthropicRequest } from './claude-transport.mjs';
import { markdownReport } from './campaign-report.mjs';

async function main() {
  const argv = process.argv.slice(2);
  if (argv.some(a => a !== '--live')) throw new Error('Only --live is supported; ceilings cannot be overridden');
  const plan = buildCampaign();
  const report = { mode: argv.includes('--live') ? 'live' : 'preflight', limits: LIMITS, provenance: plan.provenance, scenarios: plan.cases.map(({ id, assistant, request }) => ({ id, assistant, model: request.model })), results: [], reservedUsd: 0, requests: 0, paidAttempts: 0 };
  const baseDir = resolve('tmp/koji-ai-live');
  const dir = resolve(baseDir, 'run-' + randomUUID());
  await mkdir(dir, { recursive: true });
  const save = async () => { await writeFile(resolve(dir, 'report.json'), JSON.stringify(report, null, 2)+'\n');
    await writeFile(resolve(dir, 'report.md'), markdownReport(report)); };
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
    // Reserve the FULL input ceiling and output ceiling for every generation.
    // Input counting can be an estimate; the dollar cap does not depend on exact counts.
    const prepared = plan.cases.map(c => {
      const rates = pricing.models?.[c.request.model];
      return { c, rates, reservation: reserve(state, LIMITS.inputTokens, rates) };
    });
    report.reservedUsd = state.reservedUsd;
    report.estimatedCostUsd = 0;
    report.pricing = pricing; await save();
    const send = async (path, body) => {
      if (report.requests >= LIMITS.requests) throw new Error('HTTP request ceiling');
      report.requests++; await save();
      return anthropicRequest(path, body, process.env.ANTHROPIC_API_KEY);
    };
    // First scenario only, then continue sequentially after its valid API response.
    for (const { c, rates, reservation } of prepared) {
      const started = performance.now();
      const entry = { id: c.id, model: c.request.model, expected: c.message, passed: false, reservationUsd: reservation, phase: 'count_tokens' };
      report.results.push(entry); await save();
      try {
        const { max_tokens, thinking, ...countBody } = c.request;
        const counted = await send('/v1/messages/count_tokens', countBody);
        entry.countedInputTokens = counted.input_tokens;
        // Leave a margin for possible counter/usage differences, fail before generation.
        if (!Number.isInteger(counted.input_tokens) || counted.input_tokens < 1 || counted.input_tokens > LIMITS.inputTokens - 256) throw new Error('Input token ceiling or counter safety margin');
        if (report.paidAttempts >= LIMITS.messages || report.reservedUsd > LIMITS.budgetUsd) throw new Error('Campaign budget/call ceiling');
        entry.phase = 'generation'; report.paidAttempts++; await save();
        const generationStarted = performance.now();
        const response = await send('/v1/messages', c.request);
        entry.durationMs = Math.round(performance.now() - generationStarted);
        const usage = response.usage;
        if (!usage || !Number.isInteger(usage.input_tokens) || !Number.isInteger(usage.output_tokens) || usage.input_tokens < 0 || usage.output_tokens < 0 || usage.input_tokens > LIMITS.inputTokens || usage.output_tokens > LIMITS.outputTokens || usage.cache_creation_input_tokens || usage.cache_read_input_tokens) throw new Error('Unexpected usage; campaign stopped');
        const content = response.content.map(b => b.type === 'text' ? { type: b.type, text: b.text } : b.type === 'tool_use' ? { type: b.type, name: b.name, input: b.input } : { type: b.type });
        if (JSON.stringify(content).includes(process.env.ANTHROPIC_API_KEY)) throw new Error('Secret reflection blocked');
        Object.assign(entry, assess(c, response), {
          phase: 'completed', inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
          estimatedCostUsd: (usage.input_tokens * rates.input + usage.output_tokens * rates.output) / 1e6,
          stopReason: response.stop_reason, content
        });
        report.estimatedCostUsd += entry.estimatedCostUsd;
        entry.totalDurationMs = Math.round(performance.now()-started);
        await save();
        console.log(`${c.id}: response received, checks ${entry.passed ? 'passed' : 'failed'}, ${entry.inputTokens}/${entry.outputTokens} tokens, $${entry.estimatedCostUsd.toFixed(6)}, ${entry.durationMs}ms`);
      } catch (error) {
        entry.totalDurationMs = Math.round(performance.now()-started);
        entry.issues = [error.message]; if (error.safeDetail) entry.diagnostic = error.safeDetail; await save();
        throw error; // Includes authentication, timeout and model errors; never retry.
      }
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

export function markdownReport(report) {
  return [
    '# KOJI synthetic prompt campaign', '',
    `Status: ${report.status || 'in_progress'}`,
    `Paid attempts: ${report.paidAttempts}/5; HTTP requests: ${report.requests}/10`,
    `Reserved budget: ${report.reservedUsd} USD; estimated consumed: ${report.estimatedCostUsd ?? 'unavailable'} USD`, '',
    '| Scenario | Result | Input/output tokens | Estimated USD | Latency ms | Issues |',
    '| --- | --- | --- | ---: | ---: | --- |',
    ...report.scenarios.map(c => {
      const r = report.results.find(r => r.id === c.id);
      const status = !r ? 'not executed' : r.phase !== 'completed' ? r.phase : r.passed ? 'checks passed; review required' : 'failed';
      return `| ${c.id} | ${status} | ${r?.inputTokens ?? '-'}/${r?.outputTokens ?? '-'} | ${r?.estimatedCostUsd ?? '-'} | ${r?.durationMs ?? '-'} | ${r?.issues?.join(', ') || '-'} |`;
    }), '',
    'Synthetic single-turn prompt tests only. No database, tool execution, app routes or UI protocol exercised. Human review remains necessary for hallucinations.', ''
  ].join('\n');
}

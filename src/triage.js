import { compareRuns, fingerprint, validateRun } from './harness.js';

export function selectFailedCases(cases, source) {
  validateRun(source);
  if (source.datasetHash !== fingerprint([...cases].sort((a, b) => a.id.localeCompare(b.id)))) throw new Error('Failed-case source does not match this dataset. Inputs, graders, and tags must be unchanged.');
  const ids = new Set(cases.map(c => c.id));
  if (source.total !== cases.length || source.results.some(r => !ids.has(r.id))) throw new Error('Failed-case source has different case IDs.');
  const failed = new Set(source.results.filter(r => !r.passed).map(r => r.id));
  if (!failed.size) throw new Error('Source evaluation has no failed cases to rerun. No inference performed.');
  return cases.filter(c => failed.has(c.id));
}

export function caseDiffs(baseline, current) {
  const comparison = compareRuns(baseline, current);
  const rows = new Map(current.results.map(r => [r.id, r]));
  return [
    ...comparison.newFailures.map(id => ({ id, status: 'new-failure' })),
    ...comparison.fixed.map(id => ({ id, status: 'fixed' }))
  ].map(change => {
    const row = rows.get(change.id);
    const attempts = row.trials || [row];
    return {
      ...change,
      failedTrials: attempts.filter(t => !t.passed).length,
      totalTrials: attempts.length,
      reasons: change.status === 'fixed' ? [] : [...new Set(attempts.filter(t => !t.passed).flatMap(t => t.error ? [t.error] : (t.grades || []).filter(g => !g.passed).map(g => `${g.type}: ${g.reason}`)))]
    };
  });
}

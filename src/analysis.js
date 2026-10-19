import { validateRun } from './harness.js';

export function summarizeRun(run) {
  validateRun(run);
  const durations = run.results.map(r => r.durationMs).filter(n => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  const percentile = p => durations.length ? durations[Math.max(0, Math.ceil(p * durations.length) - 1)] : null;
  const groups = new Map();
  for (const row of run.results) {
    for (const grade of row.grades || []) {
      if (!grade || typeof grade.type !== 'string' || typeof grade.passed !== 'boolean') continue;
      const group = groups.get(grade.type) || { type: grade.type, total: 0, passed: 0 };
      group.total++; group.passed += Number(grade.passed); groups.set(grade.type, group);
    }
  }
  const tags = [...new Set(run.results.flatMap(r => r.tags || []))].sort();
  return {
    total: run.total,
    passed: run.passed,
    passRate: run.passed / run.total,
    errors: run.results.filter(r => typeof r.error === 'string').length,
    latency: { samples: durations.length, p50Ms: percentile(.5), p95Ms: percentile(.95), totalMs: durations.reduce((sum, n) => sum + n, 0) },
    graders: [...groups.values()].sort((a, b) => a.type.localeCompare(b.type)),
    slices: tags.map(tag => {
      const rows = run.results.filter(r => r.tags?.includes(tag));
      return { tag, total: rows.length, passed: rows.filter(r => r.passed).length };
    })
  };
}

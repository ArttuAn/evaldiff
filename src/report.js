export function validateComparison(value) {
  const c = value;
  if (!c || c.version !== 1 || !Number.isInteger(c.total) || c.total < 1 || c.total > 100000) throw new Error('Invalid comparison report.');
  for (const key of ['baselinePassed', 'currentPassed']) if (!Number.isInteger(c[key]) || c[key] < 0 || c[key] > c.total) throw new Error('Invalid pass counts.');
  const seen = new Set();
  for (const key of ['newFailures', 'fixed', 'existingFailures']) {
    if (!Array.isArray(c[key]) || c[key].length > c.total) throw new Error('Invalid failure list.');
    for (const id of c[key]) {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(id) || seen.has(id)) throw new Error('Invalid case IDs.');
      seen.add(id);
    }
  }
  if (c.currentPassed !== c.baselinePassed - c.newFailures.length + c.fixed.length || c.total - c.currentPassed !== c.newFailures.length + c.existingFailures.length || c.regression !== (c.newFailures.length > 0)) throw new Error('Inconsistent comparison report.');
  return c;
}
const rate = (n, total) => `${Number((n / total * 100).toFixed(1))}%`;
export function headline(comparison) {
  const c = validateComparison(comparison);
  return `Pass rate ${rate(c.baselinePassed, c.total)} → ${rate(c.currentPassed, c.total)}, ${c.newFailures.length} new failure${c.newFailures.length === 1 ? '' : 's'}`;
}
export function markdownReport(comparison) {
  const c = validateComparison(comparison);
  const delta = Number(((c.currentPassed - c.baselinePassed) / c.total * 100).toFixed(1));
  const list = ids => ids.length ? ids.slice(0, 40).map(id => `\`${id}\``).join(', ') + (ids.length > 40 ? ` (+${ids.length - 40} more)` : '') : 'None';
  return `<!-- evaldiff:report -->\n## ${c.regression ? '🔴' : '🟢'} EvalDiff evaluation report\n\n**${headline(c)}**\n\n| Metric | Baseline | Current |\n|:--|--:|--:|\n| Passing | ${c.baselinePassed}/${c.total} | ${c.currentPassed}/${c.total} |\n| Pass rate | ${rate(c.baselinePassed, c.total)} | ${rate(c.currentPassed, c.total)} |\n\n**Change:** ${delta > 0 ? '+' : ''}${delta} percentage points · **Fixed:** ${c.fixed.length} · **Existing failures:** ${c.existingFailures.length}\n\n- **New failures:** ${list(c.newFailures)}\n- **Fixed cases:** ${list(c.fixed)}\n\n${c.regression ? '⚠️ New regressions detected. Review the evaluation artifact before merging.' : '✅ No new regressions against the saved baseline.'}\n\n<sub>Exact-match + JSON Schema grading · A passing evaluation is not a guarantee of model safety or factual accuracy.</sub>\n`;
}

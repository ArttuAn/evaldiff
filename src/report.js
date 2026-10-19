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
  if (c.slices !== undefined) {
    if (!Array.isArray(c.slices) || c.slices.length > c.total * 20) throw new Error('Invalid slice report.');
    const tags = new Set();
    for (const slice of c.slices) {
      if (!slice || typeof slice.tag !== 'string' || !/^[a-zA-Z0-9._-]{1,64}$/.test(slice.tag) || tags.has(slice.tag)) throw new Error('Invalid slice tag.');
      tags.add(slice.tag);
      if (!Number.isInteger(slice.total) || slice.total < 1 || slice.total > c.total) throw new Error('Invalid slice total.');
      for (const key of ['baselinePassed', 'currentPassed', 'newFailures']) if (!Number.isInteger(slice[key]) || slice[key] < 0 || slice[key] > slice.total) throw new Error('Invalid slice counts.');
      if (slice.newFailures > slice.baselinePassed || slice.newFailures > slice.total - slice.currentPassed || slice.newFailures > c.newFailures.length || slice.currentPassed < slice.baselinePassed - slice.newFailures) throw new Error('Inconsistent slice counts.');
    }
  }
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
  const slices = c.slices?.length ? '\n\n### Dataset slices\n\n| Slice | Baseline | Current | New failures |\n|:--|--:|--:|--:|\n' + c.slices.slice(0, 30).map(s => `| \`${s.tag}\` | ${rate(s.baselinePassed, s.total)} | ${rate(s.currentPassed, s.total)} | ${s.newFailures} |`).join('\n') + (c.slices.length > 30 ? '\n\nFirst 30 slices shown; see the JSON artifact for all slices.' : '') : '';
  return `<!-- evaldiff:report -->\n## ${c.regression ? '🔴' : '🟢'} EvalDiff evaluation report\n\n**${headline(c)}**\n\n| Metric | Baseline | Current |\n|:--|--:|--:|\n| Passing | ${c.baselinePassed}/${c.total} | ${c.currentPassed}/${c.total} |\n| Pass rate | ${rate(c.baselinePassed, c.total)} | ${rate(c.currentPassed, c.total)} |\n\n**Change:** ${delta > 0 ? '+' : ''}${delta} percentage points · **Fixed:** ${c.fixed.length} · **Existing failures:** ${c.existingFailures.length}\n\n- **New failures:** ${list(c.newFailures)}\n- **Fixed cases:** ${list(c.fixed)}${slices}\n\n${c.regression ? '⚠️ New regressions detected. Review the evaluation artifact before merging.' : '✅ No new regressions against the saved baseline.'}\n\n<sub>Exact-match + JSON Schema grading · A passing evaluation is not a guarantee of model safety or factual accuracy.</sub>\n`;
}

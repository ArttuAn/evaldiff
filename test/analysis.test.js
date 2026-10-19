import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadCases, runCases, compareRuns } from '../src/harness.js';
import { summarizeRun } from '../src/analysis.js';
import { htmlReport } from '../src/html.js';
import { markdownReport, validateComparison } from '../src/report.js';
import app from '../examples/app.mjs';
import regressed from '../examples/regressed-app.mjs';

const cases = await loadCases(new URL('../examples/cases.jsonl', import.meta.url));
const baseline = await runCases(cases, app);
const current = await runCases(cases, regressed);
const comparison = compareRuns(baseline, current);

test('slice metrics locate failures without double-counting global cases', () => {
  const summary = summarizeRun(current);
  assert.equal(summary.total, 10);
  assert.deepEqual(summary.slices.find(s => s.tag === 'routing'), { tag: 'routing', total: 8, passed: 7 });
  assert.deepEqual(comparison.slices.find(s => s.tag === 'billing'), { tag: 'billing', total: 3, baselinePassed: 3, currentPassed: 2, newFailures: 1 });
  assert.deepEqual(summary.graders.find(g => g.type === 'exact'), { type: 'exact', total: 9, passed: 7 });
  assert.match(markdownReport(comparison), /Dataset slices/);
});
test('latency percentiles use nearest rank and ignore missing legacy samples', () => {
  const run = structuredClone(current);
  run.results.forEach((r, i) => { r.durationMs = i + 1; });
  const stats = summarizeRun(run);
  assert.deepEqual(stats.latency, { samples: 10, p50Ms: 5, p95Ms: 10, totalMs: 55 });
  run.results.forEach(r => { delete r.durationMs; });
  assert.equal(summarizeRun(run).latency.p50Ms, null);
});
test('adapter errors remain visible in grader denominators', async () => {
  const run = await runCases(cases, () => { throw new Error('offline'); });
  const summary = summarizeRun(run);
  assert.equal(summary.errors, 10);
  assert.equal(summary.graders.reduce((n, g) => n + g.total, 0), 10);
  assert.equal(summary.graders.reduce((n, g) => n + g.passed, 0), 0);
});
test('HTML escapes output and error payloads and works without baseline', () => {
  const run = structuredClone(current);
  run.results[0].output = '</pre><script>alert(1)</script>';
  run.results[0].error = '<img src=x onerror=alert(1)>';
  const html = htmlReport(run, comparison);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /default-src 'none'/);
  assert.match(htmlReport(run), /No baseline supplied/);
  assert.throws(() => htmlReport(baseline, comparison), /does not match/);
});
test('slice validation rejects unsafe tags and inconsistent counts', () => {
  const invalid = structuredClone(comparison);
  invalid.slices[0].tag = 'bad|markdown';
  assert.throws(() => validateComparison(invalid));
  const counts = structuredClone(comparison);
  counts.slices[0].newFailures = 999;
  assert.throws(() => validateComparison(counts));
  const changed = structuredClone(current);
  changed.results[0].tags = ['unexpected'];
  assert.throws(() => compareRuns(baseline, changed), /tags differ/);
});
test('dataset tags reject duplicates, nonarrays, and unsafe identifiers', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'evaldiff-tags-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const tags of [['x','x'], ['bad tag'], 'routing', Array.from({ length: 21 }, (_, i) => `tag-${i}`)]) {
    const file = join(dir, 'cases.jsonl');
    await writeFile(file, JSON.stringify({ ...cases[0], tags }));
    await assert.rejects(loadCases(file), /tags must be unique/);
  }
});
test('CLI exports HTML and aggregate metrics even when regression exits 1', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'evaldiff-report-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const html = join(dir, 'report.html'); const summary = join(dir, 'summary.json');
  const result = spawnSync(process.execPath, ['bin/evaldiff.js', 'run', '--cases', 'examples/cases.jsonl', '--adapter', 'examples/regressed-app.mjs', '--baseline', 'examples/baseline.json', '--html', html, '--summary', summary], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(await readFile(html, 'utf8'), /Case explorer/);
  assert.equal(JSON.parse(await readFile(summary)).passed, 7);
});

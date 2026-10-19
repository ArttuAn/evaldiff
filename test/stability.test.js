import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadCases, runCases, compareRuns, validateRun } from '../src/harness.js';
import { summarizeRun } from '../src/analysis.js';
import { markdownReport } from '../src/report.js';
import { htmlReport } from '../src/html.js';
import stable from '../examples/app.mjs';
import unstable from '../examples/unstable-app.mjs';

const cases = await loadCases(new URL('../examples/cases.jsonl', import.meta.url));
const one = [{ id: 'one', input: 'hello', graders: [{ type: 'exact', expected: 'hello' }] }];
const cli = (...args) => spawnSync(process.execPath, ['bin/evaldiff.js', ...args], { encoding: 'utf8' });

test('repeat executes every trial and mixed outcomes conservatively fail the case', async () => {
  const baseline = await runCases(cases, stable, { repeat: 3 });
  const current = await runCases(cases, unstable, { repeat: 3 });
  const summary = summarizeRun(current);
  assert.equal(current.passed, 7);
  assert.deepEqual(summary.stability, { trialsPerCase: 3, totalTrials: 30, passedTrials: 27, flakyCases: ['extract-contact', 'refusal', 'route-refund'] });
  assert.equal(summary.latency.samples, 30);
  assert.equal(summary.graders.reduce((n, g) => n + g.total, 0), 30);
  assert.deepEqual(current.results[0].trials.map(t => t.passed), [true, false, true]);
  const comparison = compareRuns(baseline, current);
  assert.equal(comparison.newFailures.length, 3);
  assert.match(markdownReport(comparison), /all 3 trials must pass/);
  const html = htmlReport(current, comparison);
  assert.match(html, /Repeated-trial stability/);
  assert.match(html, /27\/30/);
  assert.match(html, /Trial 2 · FAIL/);
});
test('stable passing and consistently failing cases are not labeled flaky', async () => {
  const pass = await runCases(one, x => x, { repeat: 3 });
  const fail = await runCases(one, () => 'wrong', { repeat: 3 });
  assert.equal(pass.passed, 1);
  assert.equal(fail.passed, 0);
  assert.deepEqual(summarizeRun(pass).stability.flakyCases, []);
  assert.deepEqual(summarizeRun(fail).stability.flakyCases, []);
});
test('trial errors remain failures even when subsequent trials succeed', async () => {
  const run = await runCases(one, (input, { trial }) => {
    if (trial === 1) throw new Error('transient error');
    return input;
  }, { repeat: 3 });
  assert.equal(run.passed, 0);
  assert.equal(summarizeRun(run).errors, 1);
  assert.equal(summarizeRun(run).stability.passedTrials, 2);
});
test('trial inputs and output snapshots cannot contaminate later trials', async () => {
  const items = [{ id: 'mutating', input: { n: 0 }, graders: [{ type: 'exact', expected: { n: 1 } }] }];
  const run = await runCases(items, input => { input.n++; return input; }, { repeat: 3 });
  assert.equal(run.passed, 1);
  assert.equal(items[0].input.n, 0);
  const shared = { n: 0 };
  const snapshots = await runCases([{ ...items[0], graders: [{ type: 'json-schema', schema: { type: 'object' } }] }], () => { shared.n++; return shared; }, { repeat: 3 });
  assert.deepEqual(snapshots.results[0].trials.map(t => t.output.n), [1, 2, 3]);
});
test('lossy JSON outputs are explicit failed trials, not silently corrupted artifacts', async () => {
  for (const output of [{ value: undefined }, { value: NaN }, new Date(), 1n, undefined]) {
    assert.equal((await runCases(one, () => output)).passed, 0);
  }
});
test('comparison rejects mismatched repetition and malformed trial artifacts', async () => {
  const single = await runCases(one, x => x);
  const repeated = await runCases(one, x => x, { repeat: 3 });
  assert.throws(() => compareRuns(single, repeated), /Trial counts differ/);
  const missing = structuredClone(repeated); missing.results[0].trials.pop();
  assert.throws(() => validateRun(missing), /trial results/);
  const verdict = structuredClone(repeated); verdict.results[0].trials[0].passed = false;
  assert.throws(() => validateRun(verdict), /trial results/);
  for (const repeat of [0, 101, 1.5, NaN]) await assert.rejects(runCases(one, x => x, { repeat }), /repeat/);
});
test('dataset validation performs no adapter import or model calls', () => {
  const valid = cli('validate', '--cases', 'examples/cases.jsonl');
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /10 cases/);
  assert.match(valid.stdout, /No inference performed/);
  assert.equal(cli('validate', '--cases', 'missing.jsonl').status, 2);
  assert.equal(cli('validate', '--cases', 'examples/cases.jsonl', '--adapter', 'untrusted.mjs').status, 2);
});
test('CLI checks repeated-baseline compatibility before importing adapter', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'evaldiff-repeat-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'baseline.json');
  await writeFile(file, JSON.stringify(await runCases(cases, stable, { repeat: 3 })));
  const result = cli('run', '--cases', 'examples/cases.jsonl', '--adapter', 'does-not-exist.mjs', '--baseline', file);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Trial counts differ/);
});
test('per-trial HTML evidence remains escaped', async () => {
  const run = await runCases(one, () => '<script>alert(1)</script>', { repeat: 2 });
  const html = htmlReport(run);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Trial 2 · FAIL/);
});

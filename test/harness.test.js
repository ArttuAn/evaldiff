import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { grade, loadCases, runCases, compareRuns, validateRun } from '../src/harness.js';
import { headline, markdownReport, validateComparison } from '../src/report.js';
import app from '../examples/app.mjs';
import regressed from '../examples/regressed-app.mjs';

const caseOne = { id: 'one', input: 'hello', graders: [{ type: 'exact', expected: 'hello' }] };
test('exact text matching is strict; object matching ignores key order', () => {
  assert.equal(grade('hello', { type: 'exact', expected: 'hello' }).passed, true);
  assert.equal(grade('hello\n', { type: 'exact', expected: 'hello' }).passed, false);
  assert.equal(grade({ b: 2, a: 1 }, { type: 'exact', expected: { a: 1, b: 2 } }).passed, true);
  assert.equal(grade('1', { type: 'exact', expected: 1 }).passed, false);
});
test('JSON Schema checks parsed strings, required fields, types, formats, and extras', () => {
  const grader = { type: 'json-schema', schema: { type: 'object', required: ['email'], additionalProperties: false, properties: { email: { type: 'string', format: 'email' } } } };
  assert.equal(grade('{"email":"ada@example.com"}', grader).passed, true);
  for (const value of ['not JSON', {}, { email: 5 }, { email: 'not-email' }, { email: 'ada@example.com', extra: true }]) assert.equal(grade(value, grader).passed, false);
});
test('JSONL loader rejects empty sets, invalid JSON, duplicate IDs and invalid graders', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'promptguard-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'cases.jsonl');
  for (const content of ['', '{', JSON.stringify(caseOne) + '\n' + JSON.stringify(caseOne), JSON.stringify({ ...caseOne, id: '<bad>' }), JSON.stringify({ ...caseOne, graders: [{ type: 'unknown' }] }), JSON.stringify({ ...caseOne, graders: [{ type: 'exact' }] }), JSON.stringify({ ...caseOne, graders: [{ type: 'json-schema', schema: { type: 'made-up' } }] })]) {
    await writeFile(file, content); await assert.rejects(loadCases(file));
  }
  await writeFile(file, '\n' + JSON.stringify(caseOne) + '\r\n');
  assert.equal((await loadCases(file)).length, 1);
});
test('case passes only if ALL graders pass', async () => {
  const result = await runCases([{ ...caseOne, graders: [...caseOne.graders, { type: 'exact', expected: 'different' }] }], input => input);
  assert.equal(result.passed, 0);
});
test('adapter errors and timeouts become failed cases, not a crashed run', async () => {
  const error = await runCases([caseOne], () => { throw new Error('offline'); });
  assert.equal(error.passed, 0); assert.equal(error.results[0].error, 'offline');
  let aborted = false;
  const timeout = await runCases([caseOne], (_, { signal }) => new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }); }), { timeoutMs: 5 });
  assert.equal(timeout.passed, 0); assert.match(timeout.results[0].error, /Timed out/); assert.equal(aborted, true);
  assert.equal((await runCases([caseOne], () => undefined)).passed, 0);
});
test('regression fixture produces exactly three new failures', async () => {
  const cases = await loadCases(new URL('../examples/cases.jsonl', import.meta.url));
  const baseline = await runCases(cases, app);
  const current = await runCases(cases, regressed);
  const comparison = compareRuns(baseline, current);
  assert.equal(baseline.passed, 10); assert.equal(current.passed, 7);
  assert.deepEqual(comparison.newFailures, ['extract-contact', 'refusal', 'route-refund']);
  assert.equal(headline(comparison), 'Pass rate 100% → 70%, 3 new failures');
  assert.match(markdownReport(comparison), /promptguard:report/);
});
test('new failures gate even when aggregate pass rate is unchanged', async () => {
  const cases = [caseOne, { ...caseOne, id: 'two' }];
  const baseline = await runCases(cases, (_, { id }) => id === 'one' ? 'hello' : 'bad');
  const current = await runCases(cases, (_, { id }) => id === 'two' ? 'hello' : 'bad');
  const result = compareRuns(baseline, current);
  assert.equal(result.regression, true); assert.deepEqual(result.fixed, ['two']);
  assert.equal(headline(result), 'Pass rate 50% → 50%, 1 new failure');
  assert.equal(compareRuns(baseline, baseline).regression, false);
});
test('dataset hash ignores row/key order but rejects modified inputs and graders', async () => {
  const a = await runCases([caseOne, { ...caseOne, id: 'two' }], x => x);
  const b = await runCases([{ ...caseOne, id: 'two' }, caseOne], x => x);
  assert.equal(compareRuns(a, b).regression, false);
  const changed = await runCases([{ ...caseOne, input: 'changed' }], x => x);
  assert.throws(() => compareRuns(a, changed), /Dataset changed/);
  assert.throws(() => validateRun({ ...a, passed: 99 }), /pass count/);
  assert.throws(() => validateRun({ ...a, results: [a.results[0], a.results[0]] }), /results/);
});
test('report validation rejects malicious IDs, inconsistent counts and duplicate IDs', () => {
  const valid = { version: 1, total: 100, baselinePassed: 87, currentPassed: 82, newFailures: ['a','b','c','d','e'], fixed: [], existingFailures: Array.from({ length: 13 }, (_, i) => `old-${i}`), regression: true };
  assert.equal(headline(valid), 'Pass rate 87% → 82%, 5 new failures');
  for (const invalid of [{ ...valid, newFailures: ['<script>'] }, { ...valid, currentPassed: 81 }, { ...valid, regression: false }, { ...valid, newFailures: ['a','a','c','d','e'] }]) assert.throws(() => validateComparison(invalid));
});
test('CLI returns 0/1/2, writes artifacts, and compares saved runs', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'promptguard-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cli = (...args) => spawnSync(process.execPath, ['bin/promptguard.js', ...args], { encoding: 'utf8' });
  const base = join(dir, 'baseline.json'); const current = join(dir, 'current.json'); const report = join(dir, 'comparison.json');
  assert.equal(cli('run', '--cases', 'examples/cases.jsonl', '--adapter', 'examples/app.mjs', '--out', base).status, 0);
  assert.equal(cli('run', '--cases', 'examples/cases.jsonl', '--adapter', 'examples/regressed-app.mjs', '--baseline', base, '--out', current, '--report', report).status, 1);
  assert.equal(JSON.parse(await readFile(report)).newFailures.length, 3);
  assert.equal(cli('compare', '--baseline', base, '--current', current).status, 1);
  assert.equal(cli('run', '--cases', 'missing').status, 2);
  assert.equal(cli('--help').status, 0);
});

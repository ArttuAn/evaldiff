import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
};
export const fingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export async function loadCases(path) {
  const text = await readFile(path, 'utf8');
  const cases = [];
  const ids = new Set();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let item;
    try { item = JSON.parse(line); } catch { throw new Error(`Line ${index + 1}: invalid JSON.`); }
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(item.id)) throw new Error(`Line ${index + 1}: id must be 1–100 letters, digits, dots, underscores, or hyphens.`);
    if (ids.has(item.id)) throw new Error(`Duplicate case id: ${item.id}`);
    if (!Object.hasOwn(item, 'input')) throw new Error(`Case ${item.id}: input is required.`);
    if (!Array.isArray(item.graders) || !item.graders.length) throw new Error(`Case ${item.id}: graders are required.`);
    for (const grader of item.graders) {
      if (!grader || !['exact', 'json-schema'].includes(grader.type)) throw new Error(`Case ${item.id}: unknown grader.`);
      if (grader.type === 'exact' && !Object.hasOwn(grader, 'expected')) throw new Error(`Case ${item.id}: exact grader needs expected.`);
      if (grader.type === 'json-schema') {
        if (!grader.schema || typeof grader.schema !== 'object' || Array.isArray(grader.schema)) throw new Error(`Case ${item.id}: schema must be an object.`);
        try { ajv.compile(grader.schema); } catch (error) { throw new Error(`Case ${item.id}: invalid schema: ${error.message}`); }
      }
    }
    ids.add(item.id); cases.push(item);
  }
  if (!cases.length) throw new Error('Test set is empty.');
  return cases;
}

export function grade(output, grader) {
  if (grader.type === 'exact') {
    // Text is strict (including whitespace); JSON values use structural equality.
    const passed = isDeepStrictEqual(output, grader.expected);
    return { type: grader.type, passed, reason: passed ? 'Exact match.' : 'Output did not exactly match the expected value.' };
  }
  if (grader.type !== 'json-schema') throw new Error('Unknown grader.');
  let value = output;
  if (typeof output === 'string') {
    try { value = JSON.parse(output); } catch { return { type: grader.type, passed: false, reason: 'Output is not valid JSON.' }; }
  }
  const validate = ajv.compile(grader.schema);
  const passed = validate(value);
  return { type: grader.type, passed, reason: passed ? 'JSON Schema matched.' : ajv.errorsText(validate.errors, { separator: '; ' }) };
}

export async function runCases(cases, adapter, { timeoutMs = 30000 } = {}) {
  const results = [];
  for (const item of cases) {
    const controller = new AbortController();
    let timer;
    const started = performance.now();
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error(`Timed out after ${timeoutMs}ms.`)); }, timeoutMs);
      });
      const output = await Promise.race([Promise.resolve().then(() => adapter(item.input, { id: item.id, signal: controller.signal })), timeout]);
      if (output === undefined || !['string', 'number', 'boolean', 'object'].includes(typeof output) || (typeof output === 'number' && !Number.isFinite(output))) throw new Error('Adapter must return a JSON-compatible value.');
      // Ensure outputs are serializable before creating an artifact.
      JSON.stringify(output);
      const grades = item.graders.map(grader => grade(output, grader));
      results.push({ id: item.id, passed: grades.every(g => g.passed), output, grades, durationMs: Math.round(performance.now() - started) });
    } catch (error) {
      results.push({ id: item.id, passed: false, error: error instanceof Error ? error.message : 'Adapter failed.', grades: [], durationMs: Math.round(performance.now() - started) });
    } finally { clearTimeout(timer); }
  }
  return {
    version: 1,
    datasetHash: fingerprint([...cases].sort((a, b) => a.id.localeCompare(b.id))),
    total: results.length,
    passed: results.filter(r => r.passed).length,
    results
  };
}

export function validateRun(run) {
  if (!run || run.version !== 1 || !/^[a-f0-9]{64}$/.test(run.datasetHash) || !Number.isInteger(run.total) || run.total < 1 || !Array.isArray(run.results) || run.results.length !== run.total) throw new Error('Invalid run artifact.');
  const ids = new Set();
  for (const result of run.results) {
    if (!result || typeof result.id !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(result.id) || ids.has(result.id) || typeof result.passed !== 'boolean') throw new Error('Invalid run results.');
    ids.add(result.id);
  }
  if (run.passed !== run.results.filter(r => r.passed).length) throw new Error('Invalid run pass count.');
  return run;
}

export function compareRuns(baseline, current) {
  validateRun(baseline); validateRun(current);
  if (baseline.datasetHash !== current.datasetHash) throw new Error('Dataset changed: use the same inputs and graders, then explicitly regenerate the baseline.');
  const previous = new Map(baseline.results.map(r => [r.id, r.passed]));
  if (baseline.total !== current.total || current.results.some(r => !previous.has(r.id))) throw new Error('Case IDs differ between runs.');
  const newFailures = current.results.filter(r => previous.get(r.id) && !r.passed).map(r => r.id).sort();
  const fixed = current.results.filter(r => !previous.get(r.id) && r.passed).map(r => r.id).sort();
  return {
    version: 1,
    total: current.total,
    baselinePassed: baseline.passed,
    currentPassed: current.passed,
    newFailures,
    fixed,
    existingFailures: current.results.filter(r => !previous.get(r.id) && !r.passed).map(r => r.id).sort(),
    regression: newFailures.length > 0
  };
}

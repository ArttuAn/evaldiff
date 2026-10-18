#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadCases, runCases, compareRuns } from '../src/harness.js';
import { headline, markdownReport } from '../src/report.js';

const help = `EvalDiff — evaluate outputs, compare baselines, catch regressions.

Usage:
  evaldiff run --cases cases.jsonl --adapter app.mjs --out run.json
  evaldiff run --cases cases.jsonl --prompt prompt.txt --out run.json
  evaldiff run ... --baseline baseline.json --report comparison.json --markdown report.md
  evaldiff compare --baseline baseline.json --current run.json --report comparison.json

Options:
  --adapter PATH    JS module exporting default async (input, { id, signal }) => output
  --prompt PATH     System prompt for OpenAI (requires OPENAI_API_KEY)
  --model NAME      OpenAI model (default: OPENAI_MODEL or gpt-4.1-mini)
  --timeout MS      Per-case timeout (default: 30000)
  --out PATH        Save full run artifact (includes inputs' resulting outputs)
  --report PATH     Save structured comparison (requires baseline)
  --markdown PATH   Save PR-ready Markdown (requires baseline)
  --help            Show usage

Exit codes: 0 = pass/no new failures; 1 = failing cases/new regressions; 2 = configuration/artifact error.
With a baseline, previously failing cases do not fail the gate; ANY newly failing case does.
`;
async function save(path, data) {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, data);
}
const json = path => readFile(path, 'utf8').then(JSON.parse);
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    cases: { type: 'string' }, adapter: { type: 'string' }, prompt: { type: 'string' }, model: { type: 'string' }, timeout: { type: 'string' }, out: { type: 'string' }, baseline: { type: 'string' }, current: { type: 'string' }, report: { type: 'string' }, markdown: { type: 'string' }, help: { type: 'boolean', short: 'h' }
  } });
  if (values.help || !positionals.length) { console.log(help); return; }
  if (positionals.length !== 1 || !['run', 'compare'].includes(positionals[0])) throw new Error('Use run or compare. See --help.');
  if ((values.report || values.markdown) && !values.baseline) throw new Error('--report and --markdown require --baseline.');
  let current;
  if (positionals[0] === 'run') {
    if (!values.cases || Number(Boolean(values.adapter)) + Number(Boolean(values.prompt)) !== 1) throw new Error('run requires --cases and exactly one of --adapter or --prompt.');
    const timeoutMs = Number(values.timeout ?? 30000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) throw new Error('--timeout must be an integer from 1 to 600000.');
    const cases = await loadCases(values.cases);
    // Validate baseline compatibility before spending money on inference.
    if (values.baseline) {
      const { fingerprint, validateRun } = await import('../src/harness.js');
      const base = validateRun(await json(values.baseline));
      if (base.datasetHash !== fingerprint([...cases].sort((a, b) => a.id.localeCompare(b.id)))) throw new Error('Dataset changed: regenerate the baseline explicitly before comparing.');
    }
    let adapter;
    if (values.adapter) {
      adapter = (await import(pathToFileURL(resolve(values.adapter)).href)).default;
      if (typeof adapter !== 'function') throw new Error('Adapter module must default-export a function.');
    } else {
      if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for --prompt.');
      const prompt = await readFile(values.prompt, 'utf8');
      adapter = async (input, { signal }) => {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST', signal,
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: values.model || process.env.OPENAI_MODEL || 'gpt-4.1-mini', messages: [{ role: 'system', content: prompt }, { role: 'user', content: typeof input === 'string' ? input : JSON.stringify(input) }] })
        });
        if (!response.ok) throw new Error(`OpenAI request failed (HTTP ${response.status}).`);
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new Error('OpenAI returned no text content.');
        return content;
      };
    }
    current = await runCases(cases, adapter, { timeoutMs });
    if (values.out) await save(values.out, JSON.stringify(current, null, 2) + '\n');
    console.log(`Passing: ${current.passed}/${current.total}`);
    for (const row of current.results.filter(r => !r.passed)) console.log(`  FAIL ${row.id}: ${row.error || row.grades.filter(g => !g.passed).map(g => g.reason).join('; ')}`);
  } else {
    if (!values.current || !values.baseline) throw new Error('compare requires --baseline and --current.');
    current = await json(values.current);
  }
  if (values.baseline) {
    const comparison = compareRuns(await json(values.baseline), current);
    console.log(headline(comparison));
    if (values.report) await save(values.report, JSON.stringify(comparison, null, 2) + '\n');
    if (values.markdown) await save(values.markdown, markdownReport(comparison));
    process.exitCode = comparison.regression ? 1 : 0;
  } else process.exitCode = current.passed === current.total ? 0 : 1;
}
main().catch(error => { console.error(`EvalDiff: ${error.message}`); process.exitCode = 2; });

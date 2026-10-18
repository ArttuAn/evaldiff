// Runs ONLY from the trusted default branch in the workflow_run reporter.
// Never import code, run commands, or render arbitrary Markdown from an artifact.
import { readFile } from 'node:fs/promises';
import { markdownReport } from '../src/report.js';

const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error('GITHUB_TOKEN is required.');
const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
const run = event.workflow_run;
const repo = process.env.GITHUB_REPOSITORY;
if (!run || run.event !== 'pull_request' || !['success', 'failure'].includes(run.conclusion)) {
  console.log('Not a completed PR evaluation. Skipping.');
  process.exit(0);
}
if (run.repository?.full_name !== repo) throw new Error('Unexpected repository.');
const number = run.pull_requests?.[0]?.number;
if (!Number.isInteger(number) || number < 1) {
  console.log('GitHub did not associate a PR with this run. Skipping comment; the evaluation artifact remains available.');
  process.exit(0);
}
const api = async (path, options = {}) => {
  const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }
  });
  if (!response.ok) throw new Error(`GitHub API failed: ${response.status}`);
  return response.json();
};
const pr = await api(`/pulls/${number}`);
if (pr.state !== 'open' || pr.head.sha !== run.head_sha) {
  console.log('PR is closed or this result is stale. Skipping.');
  process.exit(0);
}
const file = await readFile('.promptguard/comparison.json');
if (file.length > 1000000) throw new Error('Comparison artifact too large.');
// Validates integer bounds, count consistency, unique IDs, and a conservative ID alphabet.
const comparison = JSON.parse(file.toString());
const body = markdownReport(comparison) + `\n[View evaluation run](https://github.com/${repo}/actions/runs/${run.id})\n`;
let existing;
for (let page = 1; page <= 10; page++) {
  const comments = await api(`/issues/${number}/comments?per_page=100&page=${page}`);
  existing = comments.find(comment => comment.user?.login === 'github-actions[bot]' && comment.body?.includes('<!-- promptguard:report -->'));
  if (existing || comments.length < 100) break;
}
await api(existing ? `/issues/comments/${existing.id}` : `/issues/${number}/comments`, { method: existing ? 'PATCH' : 'POST', body: JSON.stringify({ body }) });
console.log(existing ? 'Updated evaluation comment.' : 'Created evaluation comment.');

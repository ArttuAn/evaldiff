# Changelog

## 0.2.0

### Evaluation analysis
- Tagged dataset slices with per-slice baseline/current pass rates and new failure counts.
- Per-grader outcome breakdown and adapter-error counts.
- Nearest-rank p50/p95 latency, timing sample count, and total observed duration.
- `--summary` for portable aggregate metrics without raw outputs.

### Reporting
- `--html` for an offline, script-free evaluation dashboard with expandable case evidence.
- Slice comparison tables in Markdown, Actions summaries, and PR comments.
- Example HTML report and real desktop screenshot in the README.

### Reliability
- 17 automated tests, including tag validation, percentile math, HTML escaping, and failing-run exports.
- CI compatibility checks on Node.js 22 and 24.
- Adapter errors explicitly fail all configured grader applications instead of disappearing from grader denominators.
- The example baseline was intentionally refreshed after adding dataset tags; its 10/10 passing outcomes are unchanged.

## 0.1.0

Initial evaluation runner, exact-match and JSON Schema graders, saved baselines, case-level regression gates, and isolated updating PR bot. Originally released under the PromptGuard name; subsequently renamed EvalDiff.

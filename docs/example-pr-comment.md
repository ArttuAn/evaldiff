<!-- evaldiff:report -->
## 🔴 EvalDiff evaluation report

**Pass rate 100% → 70%, 3 new failures**

| Metric | Baseline | Current |
|:--|--:|--:|
| Passing | 10/10 | 7/10 |
| Pass rate | 100% | 70% |

**Change:** -30 percentage points · **Fixed:** 0 · **Existing failures:** 0

- **New failures:** `extract-contact`, `refusal`, `route-refund`
- **Fixed cases:** None

### Dataset slices

| Slice | Baseline | Current | New failures |
|:--|--:|--:|--:|
| `billing` | 100% | 66.7% | 1 |
| `extraction` | 100% | 0% | 1 |
| `refusal` | 100% | 0% | 1 |
| `routing` | 100% | 87.5% | 1 |
| `sales` | 100% | 100% | 0 |
| `structured-output` | 100% | 0% | 1 |
| `support` | 100% | 100% | 0 |

⚠️ New regressions detected. Review the evaluation artifact before merging.

<sub>Exact-match + JSON Schema grading · A passing evaluation is not a guarantee of model safety or factual accuracy.</sub>

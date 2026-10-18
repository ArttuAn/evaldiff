# Live PR reporter verification

This demo branch intentionally changed `npm run demo` to the broken adapter, producing 3 new failures. Its next commit restored the working adapter to verify that the same bot comment updates to green rather than creating another comment.

The main branch does not include the intentional regression. See PR #1 for the commit history and evaluation checks.

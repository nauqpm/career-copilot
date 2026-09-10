# M3 — Job intake and opportunities

This is the consolidated delivery record for the bounded M3 subset. Implementation was split into branch-from-main increments:

- `feature/job-captures` — immutable local captures and advisory duplicate hints.
- `feature/opportunity-decisions` — immutable candidate-reviewed pair decisions and hash-checked opportunity state.
- `feature/opportunity-review` — existing job-detail review UI, end-to-end acceptance coverage and the transitive-union correctness fix.

The branch-local [report](../report.md) contains the current verification evidence, coverage, browser-verification limitation and recovery boundary. M3 does not authorize URL fetch, portal connectors, fuzzy/semantic matching, source-bound analysis or application submission.

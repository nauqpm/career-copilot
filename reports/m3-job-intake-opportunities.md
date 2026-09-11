# M3 — Job intake and opportunities

This is the consolidated delivery record for the bounded M3 subset. Implementation was split into branch-from-main increments:

- `feature/job-captures` — immutable local captures and advisory duplicate hints.
- `feature/opportunity-decisions` — immutable candidate-reviewed pair decisions and hash-checked opportunity state.
- `feature/opportunity-review` — existing job-detail review UI, end-to-end acceptance coverage and the transitive-union correctness fix.

The branch-local [report](../report.md) contains the current verification evidence, coverage, browser-verification limitation and recovery boundary. M3 does not authorize URL fetch, portal connectors, fuzzy/semantic matching, source-bound analysis or application submission.

## Follow-up delivery mapping

The original three names above describe historical delivery increments. The five follow-up branches are sibling snapshots, not a dependency chain. The combined delivery branch is `feature/review-remediation`, starting from UX `3358cc6` with local main base `fdb1571`.

| Track | Source branch | Integration scope |
| --- | --- | --- |
| A | `feature/opportunity-graph-repair` | Deterministic union and four-node contradiction regression; UX already contains the union correction. |
| B | `feature/capture-integrity` | Raw/manifest source mapping, verified hint candidates and incomplete scans, plus the junction regression. |
| C | `feature/opportunity-readiness` | Reuse workspace summaries for read/write readiness and consistently mark missing legacy source files. |
| D | `feature/opportunity-review-ux` | Stable confirmation, stale-response isolation, repair peer filtering and protection for edits during pending saves. |

`feature/opportunity-graph-fix` remains a historical reference; it is not a second graph delta to merge. Integration evidence and remaining limits are recorded in `report.md`. Existing source branches are preserved and no remote merge or push is implied.

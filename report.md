# Integrated opportunity review remediation

## Scope and ancestry

Delivery branch: `feature/review-remediation`.
Starting UX SHA: `3358cc67b4f715ba74be76cd5b9971b4cd1b4e6f`.
Local main base: `fdb1571bb3349b9bd1ab7aba366880badec9ae03`.

This branch retains the existing M3.1/M3.2/M3.3 foundation and UX fixes, then integrates the missing B/C deltas and report findings. It is a combined delivery branch, not a graph-only delta against main. The five source branches remain unchanged. Implementation and independent review workers use GPT-5.6 Luna with reasoning max as requested.

| Finding | Resolution on this branch |
| --- | --- |
| F1 | Existing deterministic union retained; added four-node transitive contradiction coverage with bounded root/edge order variants. |
| F2 | Existing stable-poll confirmation, stale success/failure isolation and repair-peer filtering retained and covered by the registered suite. |
| F3 | Repair markers and write gates share one source-health predicate, including missing legacy source.md; healthy unrelated pairs remain writable. |
| F4 | Valid job-name symbolic links/junctions mark the duplicate scan incomplete without traversal. Windows junction regression passes. |
| F5 | Delayed saves update persisted state while retaining a newer form draft. Confirmation is invalidated for the new state; regression verifies the outgoing relation and retained new selection. |
| F6 | Capture B provenance checks and readiness C summary reuse now coexist with graph and UX fixes. |

Canonical raw/manifest source mapping rejects mismatched metadata, damaged capture candidates do not produce trusted duplicate hints, and opportunity reads/writes reuse workspace summaries rather than repeatedly reading details. No dependencies were added.

Implementation commits: `c444301` (capture), `22670bc` (readiness/graph), `5a7d901` (UX). The verification below covers this source/test tree; the following documentation-only commit records these results.

Independent Luna review found no actionable correctness, security or regression findings in the bounded diff from `3358cc6`.

## Fresh verification — 2026-09-11

- Registered full suite, Node test runner with concurrency one and experimental coverage: **213 passed, 0 failed, 0 skipped**.
- All-files coverage (including test files): **96.35% lines, 88.42% branches, 96.83% functions**.
- Changed runtime line/branch coverage: app.js 99.15% / 87.31%; capture.ts 98.10% / 70.00%; workspace/storage.ts 95.96% / 91.36%; workspace/opportunities.ts 99.15% / 90.79%. Coverage is not claimed to exceed 80% in every individual file/metric.
- Final TypeScript build: passed.
- `pnpm audit --audit-level=high`: no known vulnerabilities found.
- `git diff --check`: passed.
- Focused RED/GREEN evidence: capture regressions produced four intended failures before the fix; missing legacy source marker failed before the readiness fix; delayed draft regression failed against the prior UI logic. Existing graph correction already passed the new graph regression.

Reproduction (PowerShell):

```powershell
$reviewTests = ((Get-Content package.json -Raw | ConvertFrom-Json).scripts.test -split ' ') | Where-Object { $_ -like 'tests/*' }
node --test --test-concurrency=1 --experimental-test-coverage --import tsx @reviewTests
node node_modules/typescript/bin/tsc --pretty false
pnpm audit --audit-level=high
git diff --check
```

Node 20.19.0 was used. Sandbox Node startup initially failed with EPERM while resolving C:\Users\quanp; verification then ran successfully with approved execution outside the sandbox.

## Browser evidence and limits

A real in-app browser exercised an isolated synthetic workspace: create two matching captures, display advisory duplicates, select and confirm a pair, blur and allow stable polling, save same, reload the updated UI, then clear the decision and observe separated groups. The test server was stopped afterward. The browser smoke used the already-running backend; fresh backend integration is covered by the full suite. Deliberately delayed responses and route races are covered by the synthetic controller tests, not a real-browser network-delay test. This is bounded smoke evidence, not exhaustive browser E2E coverage.

Source preservation, legacy readability, corrupt-state blocking, and pointer conflict handling remain covered by tests. No real career data was used for verification. Recovery still requires stopping writers, backing up the workspace, and restoring matching pointer/revision files together. Historical drafts are not promoted to reviewed/approved.

Remote main, GitHub CI and PR state were not verified in this task. No push, merge or remote PR was performed. M4/M5, portal fetching, automatic submission, accounts, databases and agent services remain outside scope.

## Task 1 — source-bound analysis revision contract (2026-09-12)

Implementation is limited to the immutable parser/serializer, its focused contract tests, and the `analyze-job` skill handoff. The exact source text remains the authority: each requirement carries a locally generated safe ID and a JavaScript string-offset locator whose quote must equal `source.slice(start, end)`. The parser reuses `parseJobAnalysis` for the semantic body, verifies the source hash and capture/job binding, rejects duplicate IDs and score fields, requires truthful agent/model/prompt metadata, and verifies the lowercase SHA-256 envelope hash. Legacy flat `JobAnalysis` parsing and legacy files are unchanged; no migration, persistence, model invocation, or external action was added.

### RED evidence

Command:

```powershell
pnpm exec tsx --test tests/job-analysis-revisions.test.ts
```

Observed after the focused test was written and before the production module existed: **1 test file failed, 0 passed**, with the expected `ERR_MODULE_NOT_FOUND` for `src/job/analysis-revisions.js`.

### GREEN and regression evidence

Commands:

```powershell
pnpm exec tsx --test tests/job-analysis-revisions.test.ts tests/job-input.test.ts
pnpm test
pnpm build
git diff --check
```

- Focused contract plus legacy input tests: **21 passed, 0 failed, 0 skipped** (5 contract tests and 16 existing job-input tests).
- Registered repository suite: **217 passed, 0 failed, 0 skipped**.
- TypeScript build: **passed**.
- Whitespace check: **passed**.

### Compatibility and remaining limits

Existing `JobAnalysis` validation remains the semantic compatibility layer and passes unchanged. The contract intentionally does not resolve fuzzy quotes, convert byte offsets, infer missing facts, calculate scores, assign recommendations, publish revisions, or read capture manifests from disk; those concerns remain for later bounded tasks. `manifestHash` is validated as a lowercase SHA-256 identifier here, while the publisher must bind it to the verified local manifest when persistence is added. No private career data or network provider was used.

### Task 1 review fix — strict UTC calendar validation (2026-09-12)

Round-1 review found that `Date.parse` accepts calendar-overflow timestamps such as `2026-02-30T05:00:00Z` and normalises them to `2026-03-02T05:00:00.000Z`. The regression test was added before the fix and produced **5 passed, 1 failed** with `AssertionError: Missing expected exception.` The validator now parses each UTC date/time component, round-trips it through `Date#setUTCFullYear`/`setUTCHours`, and rejects any overflow while retaining the RFC3339 UTC shape check.

Fix verification:

- `pnpm exec tsx --test tests/job-analysis-revisions.test.ts tests/job-input.test.ts`: **22 passed, 0 failed, 0 skipped**.
- `pnpm test`: **217 passed, 0 failed, 0 skipped**.
- `pnpm build`: **passed**.
- `git diff --check`: **passed**.

## Task 2 — immutable analysis history and source-bound publication (2026-09-12)

The analysis storage path is additive to the M3 capture layout. It verifies the exact `source.md` bytes, the parsed `source.json` manifest and the `raw.json` capture marker before accepting a source-bound `JobAnalysisRevision`. Valid revisions are written create-only under `analyses/<revision-id>.json`; only then is `analyses/current.json` advanced with the observed pointer hash. The legacy `analysis.json` artifact is never written or promoted. Current reads fail closed for malformed or dangling pointers, while history isolates malformed or source-mismatched orphan files. The CLI exposes a minimal exact-source handoff and a local validation/publication command; it does not invoke a model or external provider.

### RED evidence

Command:

```powershell
pnpm exec tsx --test tests/job-analysis-storage.test.ts
```

Observed after the persistence tests were written and before the storage module existed: **1 test file failed, 0 passed**, with the expected `ERR_MODULE_NOT_FOUND` for `src/job/analysis-storage.js`.

### GREEN and regression evidence

Commands:

```powershell
pnpm exec tsx --test tests/job-analysis-storage.test.ts
pnpm exec tsx --test tests/job-analysis-storage.test.ts tests/job-capture.test.ts tests/m3-opportunity-flow.test.ts
pnpm test
pnpm build
git diff --check
```

- Task 2 persistence and CLI tests: **7 passed, 0 failed, 0 skipped**.
- Task 2 plus M3 capture and opportunity-flow regressions: **23 passed, 0 failed, 0 skipped**.
- Registered repository suite: **217 passed, 0 failed, 0 skipped**.
- TypeScript build: **passed**.
- Whitespace check: **passed**.

Coverage includes first create-only publication, second revision pointer comparison, immutable old bytes, stale pointer conflicts with valid orphan retention, malformed and dangling pointer repair behavior, malformed orphan isolation, and refusal of legacy, missing-manifest, changed-source and changed-raw capture state. CLI tests confirm context output contains only the selected job/source binding and that publication reports the revision ID/hash without model execution. Existing capture bytes and M3 opportunity flow remain green; no legacy artifact or unrelated worktree file was changed.

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

## Task 2 round-1 hardening (2026-09-12)

The review fixes reserve `current` as an analysis revision ID before any write, require each history file's JSON filename stem to equal its validated revision ID, add live changed-manifest and raw capture-binding regressions, and separate history artifact I/O from expected malformed/source-mismatch parsing. History now propagates path-safety and unexpected read errors instead of swallowing them; only invalid revision content is isolated.

### RED evidence

Command:

```powershell
pnpm exec tsx --test tests/job-analysis-storage.test.ts
```

Observed after adding the four review regressions and before the hardening changes: **11 tests ran, 8 passed, 3 failed**. The expected failures were the reserved `current` ID (a pointer conflict instead of a reserved-ID error), renamed filename stem still listed as active, and a symlink JSON history entry being silently skipped instead of raising a path-safety error. The changed-manifest and tampered-raw-binding cases already failed closed and remained as explicit coverage.

### GREEN and regression evidence

Commands:

```powershell
pnpm exec tsx --test tests/job-analysis-storage.test.ts
pnpm exec tsx --test tests/job-analysis-storage.test.ts tests/job-capture.test.ts tests/m3-opportunity-flow.test.ts
pnpm test
npm run build
git diff --check
pnpm audit --audit-level=high
```

- Hardened Task 2 tests: **11 passed, 0 failed, 0 skipped**.
- Hardened Task 2 plus M3 capture/opportunity regressions: **27 passed, 0 failed, 0 skipped**.
- Registered repository suite: **217 passed, 0 failed, 0 skipped**.
- TypeScript build: **passed**.
- Whitespace check: **passed**.

The prior immutable publication, stale-pointer, legacy refusal, exact-source CLI, capture-byte and opportunity-flow guarantees remain green. Unrelated untracked M3 artifacts remain untouched.

## Task 3 — evidence-linked assessment schema and global policy (2026-09-12)

Task 3 is limited to the structural `m4-v1` assessment contract, its global policy helpers, the forward-facing `assess-job` skill handoff, and synthetic contract tests. The parser accepts only the locked envelope shape: source/job/profile IDs and lowercase SHA-256 bindings, truthful match-analyst metadata, strict calendar-valid RFC3339 UTC timestamps, safe IDs with `current` reserved, exact recommendation/confidence/policy enums, and an envelope `contentHash`. It rejects scores, legacy CV authority fields, unsupported question owners, duplicate requirement/claim IDs, missing evidence for positive/conflicting findings and blockers, and evidence attached to unresolved verdicts. It does not perform matching, synonym expansion, salary parsing, geocoding, ranking, recommendation scoring, or evidence lookup; Task 4 owns live reference validation.

The skill now consumes only a generated locked context and emits JSON for `MatchAssessment`. It preserves original requirement IDs/modalities, keeps Docker distinct from Kubernetes, retains unknown/not-evidenced states, requires explicit candidate/employer question ownership, treats salary gross/net ambiguity and HCMC/hybrid facts as source-bound clarification material, and records prompt-injection text as an anomaly without granting tools or changing output authority. CV creation, profile updates, JD-directed tool calls, approvals, and submission behavior are explicitly outside this path.

### RED evidence

Commands:

```powershell
pnpm exec tsx --test tests/match-schema.test.ts
pnpm exec .\node_modules\.bin\tsx.CMD --test tests/match-schema.test.ts
```

The package fallback wrapper could not resolve the local `tsx` bin in this restricted Windows shell. The equivalent local-bin run, after authorized Node path resolution, failed as intended before the production modules existed with `ERR_MODULE_NOT_FOUND` for `src/match/schema.js` (**1 test file failed, 0 passed**).

### GREEN and forward-test evidence

Commands:

```powershell
pnpm exec .\node_modules\.bin\tsx.CMD --test tests/match-schema.test.ts
node node_modules/typescript/bin/tsc --pretty false
pnpm exec .\node_modules\.bin\tsx.CMD --test tests/match-schema.test.ts tests/job-analysis-revisions.test.ts tests/job-analysis-storage.test.ts tests/job-input.test.ts tests/job-capture.test.ts tests/m3-opportunity-flow.test.ts
pnpm test
git diff --check
```

- Focused schema/policy suite: **9 passed, 0 failed, 0 skipped**.
- Focused suite plus Task 1/2, capture, input, and M3 opportunity regressions: **58 passed, 0 failed, 0 skipped**.
- Registered repository suite: **217 passed, 0 failed, 0 skipped**.
- The same synthetic baseline scenario independently parsed through `parseMatchAssessment`: exact Node evidence remains supported, Docker remains only partially supported, Kubernetes remains unknown with empty evidence, required/preferred/unknown modalities are retained, salary gross/net ambiguity remains a clarification, stated HCMC/hybrid facts remain explicit, and prompt-injection text is an anomaly only.
- The rewritten skill contract was manually forward-tested against that locked scenario: it names no legacy `JobDecision`/CV output, emits no authority fields, and preserves the baseline injection and technology-boundary behavior. No prose grep is used as a behavioral test.
- TypeScript build: **passed**; whitespace check: **passed**.

The policy is intentionally structural. Its reusable coverage helper checks exact requirement ID/modality preservation when a later context/storage layer supplies the source analysis; it does not infer equivalence or recommendation outcomes. No legacy `JobDecision`, capture, profile, opportunity, or unrelated worktree bytes were changed.

## Task 3 round-1 review fixes (2026-09-12)

The review fixes keep match/job/requirement IDs on the lowercase reserved-safe validator while separating profile evidence IDs onto the exact existing profile namespace: `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`, with `..` forbidden. Regression coverage accepts `Evidence_1` and `evidence.1` and rejects traversal-like `evidence..1`. The `assess-job` handoff now requires trusted caller-supplied producer/run metadata (`skillVersion`, `model`, and `promptHash`) alongside the locked local context, copies those values exactly into `createdBy`, and states that the validator never derives or invents them. Coverage tests now explicitly exercise missing, extra, and modality-mismatched requirement assessments through the exported helper intended for Task 4 live storage validation.

### RED evidence

After adding the round-1 regressions and before the evidence-validator/skill changes:

```powershell
pnpm exec .\node_modules\.bin\tsx.CMD --test tests/match-schema.test.ts
```

Result: **11 tests ran, 10 passed, 1 failed**. The expected failure was the valid `Evidence_1`/`evidence.1` namespace case being rejected by the old lowercase match-ID validator; traversal remained rejected and the coverage/metadata regressions passed against the existing helper/parser.

### GREEN evidence

```powershell
pnpm exec .\node_modules\.bin\tsx.CMD --test tests/match-schema.test.ts
```

Result: **11 passed, 0 failed, 0 skipped** after the minimal separate evidence-ID validator and skill contract correction.

## Task 4 — locked context, assessment history and freshness (2026-09-12)

Task 4 adds only the local match context and assessment storage layer. A context can be ready only when the verified capture, current source-bound analysis, explicitly requested or current published profile revision, and all profile evidence artifacts validate together. Assessment writes validate exact analysis requirement IDs/modalities, selected-profile evidence mappings and preference claim paths, capture/source/analysis/profile hashes, then create the immutable assessment before advancing the optimistic `assessments/current.json` pointer. History isolates malformed or filename-mismatched orphans, current reads fail closed for dangling pointers, and safe-path/filesystem failures propagate. Freshness reports policy drift, newer analysis/profile revisions, and capture/source repair conditions without rewriting prior bytes. Legacy files remain untouched and no run metadata is invented by the context reader.

### RED evidence

Commands:

```powershell
pnpm exec tsx --test tests/match-context.test.ts tests/match-storage.test.ts
.\node_modules\.bin\tsx.CMD --test tests/match-context.test.ts tests/match-storage.test.ts
```

The package wrapper could not resolve `tsx` in this restricted Windows shell, and the sandboxed local invocation hit the known Node `EPERM: operation not permitted, lstat 'C:\\Users\\quanp'` startup boundary. The equivalent local-bin run with authorized Node path resolution then failed as intended before production modules existed: **2 test files failed, 0 passed**, with `ERR_MODULE_NOT_FOUND` for `src/match/context.js` and `src/match/storage.js`.

### GREEN and regression evidence

Commands:

```powershell
.\node_modules\.bin\tsx.CMD --test tests/match-context.test.ts tests/match-storage.test.ts
.\node_modules\.bin\tsx.CMD --test tests/match-context.test.ts tests/match-storage.test.ts tests/match-schema.test.ts tests/job-analysis-revisions.test.ts tests/job-analysis-storage.test.ts tests/job-input.test.ts tests/job-capture.test.ts tests/profile-versions.test.ts tests/profile-evidence.test.ts tests/m3-opportunity-flow.test.ts
$testFiles = @(rg --files tests -g '*.test.ts'); & '.\node_modules\.bin\tsx.CMD' --test $testFiles
npm run build
git diff --check
```

- Task 4 focused context/storage suite: **11 passed, 0 failed, 0 skipped**.
- Task 4 plus schema, analysis, capture, profile and M3 opportunity regressions: **96 passed, 0 failed, 0 skipped**.
- Complete repository test tree, including the new Task 4 files: **256 passed, 0 failed, 0 skipped**.
- TypeScript build: **passed**.
- Whitespace check: **passed**.

The focused fixtures cover exact profile selection without fallback, blocked legacy/corrupt inputs, immutable assessment bytes, reserved IDs, stale pointer conflicts with orphan retention, live reference/hash validation, dangling pointer repair, malformed/renamed orphan isolation, safe-path error propagation, and stale detection for profile, analysis, policy and source changes. All tests use synthetic temporary workspaces; no private career data or external provider was used.

## Task 4 round-1 fix — exact assessment bindings (2026-09-12)

The first review found that a ready `MatchContext` retained parsed revisions but dropped the exact on-disk hashes that `saveMatchAssessment` requires. The context now exposes `analysisHash` and `profileRevisionHash`; the assess-job contract tells producers to copy them directly into `jobRef.analysisHash` and `profileRef.revisionHash` without recomputing or inventing values. Existing parsed revisions, evidence and policy fields remain unchanged.

### RED evidence

After adding the context-to-storage integration regression and before exposing the hashes:

```powershell
node .\node_modules\tsx\dist\cli.mjs --test tests/match-context.test.ts
```

Result: **5 tests ran, 4 passed, 1 failed**. The new producer-path regression failed at assessment parsing with `jobRef.analysisHash must be a lowercase SHA-256 value`, proving that context-only construction could not reach storage.

### GREEN and regression evidence

```powershell
node .\node_modules\tsx\dist\cli.mjs --test tests/match-context.test.ts tests/match-storage.test.ts
$testFiles = @(rg --files tests -g '*.test.ts'); & '.\node_modules\.bin\tsx.CMD' --test $testFiles
npm run build
git diff --check
```

- Focused context/storage suite: **12 passed, 0 failed, 0 skipped**.
- Complete repository test tree: **257 passed, 0 failed, 0 skipped**.
- TypeScript build: **passed**.
- Whitespace check: **passed**.

## Task 5 — local assessment workflow (2026-09-12)

Task 5 adds local-only assessment handoff commands and read-only HTTP reads. `career match context` returns the exact selected analysis/profile context and hashes, `career match validate` performs structural validation without writing, and `career match publish` rechecks live capture, analysis, profile and evidence bindings before using the existing immutable assessment/pointer storage. The server exposes blocked preflight context, assessment history, current assessment freshness and historical detail with quoted pointer/artifact ETags. Ordinary unpublished preflight blocks remain readable; corrupt captures, pointers, or assessment history return repair responses. Job summaries add assessment status/history without changing legacy analysis, decision, or opportunity fields. No provider, browser authoring endpoint, score, CV, submission or remote storage path was added.

### RED evidence

Commands:

```powershell
pnpm exec tsx --test tests/m4-matching-flow.test.ts tests/workspace.test.ts
.\node_modules\.bin\tsx.CMD --test tests/m4-matching-flow.test.ts tests/workspace.test.ts
```

The package wrapper could not resolve the local `tsx` executable and the sandboxed local-bin invocation hit the known Node `EPERM: operation not permitted, lstat 'C:\\Users\\quanp'` startup boundary. The equivalent local-bin run with authorized Windows path resolution then failed as intended before the Task 5 implementation: **25 tests ran, 19 passed, 6 failed**, with the six new CLI/API expectations returning the pre-existing command/route failures.

### GREEN and compatibility evidence

Commands:

```powershell
.\node_modules\.bin\tsx.CMD --test tests/m4-matching-flow.test.ts tests/workspace.test.ts
$testFiles = @(rg --files tests -g '*.test.ts'); & '.\node_modules\.bin\tsx.CMD' --test $testFiles
npm run build
git diff --check
```

- Focused Task 5 CLI/API/workspace suite: **27 passed, 0 failed, 0 skipped**.
- Complete test tree, including all existing CLI, workspace, profile, opportunity and prior matching tests: **265 passed, 0 failed, 0 skipped**.
- TypeScript build: **passed**.
- `git diff --check`: **passed**.
- `pnpm audit --audit-level=high`: **no known vulnerabilities found**.

Coverage includes ready and blocked context, exact profile-revision selection, structural validation without writes, optimistic publish conflict with unchanged current pointer, URL-decoded safe IDs, malformed profile-revision query rejection, quoted ETags for pointer/artifact reads, freshness output, absent assessment 404s, repair 409s, non-leaking generic errors, and additive workspace assessment status/history. Synthetic temporary workspaces only; no private career data or provider invocation was used. Existing legacy artifact bodies, M3 grouping fields and source bytes remain unchanged.

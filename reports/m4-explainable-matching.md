# Explainable matching delivery record

**Date:** 2026-09-12
**Status:** Bounded local delivery verified; broader matching remains deferred

## Delivered scope

This delivery connects one verified local JD capture to one source-bound immutable analysis revision, one explicitly selected or current published profile revision, and immutable evidence-linked assessment revisions. It adds no provider execution, database, score, ontology, connector, CV, approval or submission authority.

The persisted paths are:

```text
data/jobs/<job-id>/
  source.md
  source.json
  raw.json
  analyses/<analysis-id>.json
  analyses/current.json
  assessments/<assessment-id>.json
  assessments/current.json
data/profile/
  revisions/<profile-revision-id>.json
  evidence/<evidence-id>.json
  current.json
```

Each revision is create-only and content-hashed. A current pointer advances only with the observed pointer hash. A conflict can leave a valid orphan revision, while the previous current pointer and all prior immutable bytes remain unchanged. History lists only validated, filename-matching revisions; malformed or mismatched orphans remain available for repair inspection.

## Local skill and CLI handoff

The local skills are proposal producers. `skills/analyze-job/SKILL.md` receives the exact source-bound context and emits JSON-only analysis with stable requirement IDs and exact source locators. `skills/assess-job/SKILL.md` receives a locked context and emits JSON-only assessment data with caller-supplied producer metadata. JD text is untrusted data and cannot invoke tools.

The CLI/server own validation and persistence:

```text
career job analysis-context <job-id> --root <workspace>
career job publish-analysis <job-id> <analysis.json> --root <workspace> --expected-hash missing|sha256:<pointer-hash>
career match context <job-id> --root <workspace> [--profile-revision <id>]
career match validate <assessment.json>
career match publish <job-id> <assessment.json> --root <workspace> --expected-hash missing|sha256:<pointer-hash>
```

`match validate` is structure-only and does not write. `match publish` rechecks the live capture, analysis, profile revision, profile evidence IDs, claim paths and exact hashes before writing. Read-only HTTP routes expose locked context, history, current assessment/freshness and historical detail. The existing profile publish flow remains candidate-confirmed and creates the evidence artifacts used by the assessment.

## Synthetic acceptance flow

The existing `tests/m4-matching-flow.test.ts` was extended rather than introducing another runner. Its synthetic flow now:

1. captures a bilingual JD with exact source bytes, including the Vietnamese line `Hybrid tại Hồ Chí Minh.` and its validated source locator;
2. publishes a source-bound analysis revision;
3. publishes a profile revision and leaf evidence;
4. creates a locked context carrying the exact analysis/profile hashes;
5. validates and publishes an assessment;
6. reads the current assessment through the local API and feeds that response to the existing job-detail renderer;
7. publishes a new profile, reads the prior assessment through the public current-assessment API as stale, and renders the stale status/reason in the job detail; and
8. validates and publishes a replacement assessment against the new profile.

The test compares the original `source.md`, `source.json`, `raw.json`, analysis revision/pointer, profile revision, profile evidence and first assessment bytes after the replacement. All remain byte-identical. Mutable current pointers advance only where expected.

The broader fixtures cover exact requirement/evidence binding, required/preferred/unknown modality preservation, Docker not becoming Kubernetes, missing skills remaining unknown/not-evidenced, HCM/hybrid facts, gross/net salary clarification, prompt-injection anomalies, stale reasons, blocked preflight states, repair responses, quoted ETags, unsafe IDs and legacy compatibility.

## Fresh release gates

The registered `test` script contains the original explicit test list plus the six analysis/matching test files. Final authorized runs used the current worktree; no prior counts were reused.

| Gate | Result |
| --- | --- |
| `npm test` | **285 passed, 0 failed, 0 skipped** |
| `npm run build` | **passed** (`tsc`) |
| `git diff --check` | **passed**; Git emitted only LF/CRLF normalization warnings |
| `pnpm audit --audit-level=high` | **no known vulnerabilities found** |

Node's built-in coverage command was run over all 25 paths in the registered script:

```powershell
node --experimental-test-coverage --import tsx --test <the 25 test paths in package.json>
```

It reported **285 passed, 0 failed, 0 skipped** and the following new-module evidence. Node's built-in reporter exposes line, branch and function percentages; the line percentage is the available statement/line measure.

| Module | Lines (statement/line) | Branches | Functions |
| --- | ---: | ---: | ---: |
| `src/job/analysis-revisions.ts` | 99.53% | 85.71% | 100.00% |
| `src/job/analysis-storage.ts` | 97.36% | 89.77% | 100.00% |
| `src/match/context.ts` | 98.36% | 87.36% | 100.00% |
| `src/match/policy.ts` | 97.17% | 83.87% | 100.00% |
| `src/match/schema.ts` | 100.00% | 83.04% | 100.00% |
| `src/match/storage.ts` | 92.56% | 82.95% | 91.30% |

The first sandboxed `npm test` launch was blocked before test discovery by the Windows Node user-profile `lstat` boundary (`EPERM: operation not permitted`); the same local commands were rerun with the authorized runtime and the results above are from those fresh runs.

## Browser and UI evidence

The automated renderer/controller suites exercised the assessment snapshot, exact source quotes, modality/verdict labels, evidence/claim-path display, stale reasons, blocked/repair/legacy states, narrow-screen overflow semantics, keyboard focusability, route races and network request ordering. The synthetic acceptance test also rendered the API response through the existing job-detail renderer.

Manual browser verification is **blocked**, not passed. The available environment exposed only the Codex in-app browser, and this subagent returned `IAB visibility is not supported in a subagent thread`; hidden local-tab navigation was also rejected with `net::ERR_BLOCKED_BY_CLIENT`. No claim is made about a manual wide/narrow browser pass.

## Compatibility, recovery and limits

- Existing `analysis.json`, `decision.json`, legacy profile files, M3 capture bytes and opportunity artifacts remain readable and are not silently migrated, overwritten or relabelled.
- A legacy-only analysis or profile blocks the new context rather than falling back. Missing/unpublished inputs remain actionable blocked states; corrupt capture, pointer, evidence or history returns a generic repair state without absolute paths or private source content.
- A changed profile, analysis, policy or capture/source marks an existing assessment stale with explicit reasons. Staleness does not rewrite the assessment.
- Vietnamese and English text stays free-form and source-bound. The implementation does not infer skill equivalence, turn adjacent experience into a qualification, convert `20–30 triệu` without gross/net facts, or guess commute.
- The profile revision supplies the preference version for this subset; saved custom policies, role-family policy, ontology, salary conversion, geocoding, broader analytics and anomaly overrides are deferred.
- Provider/model execution, remote storage, database persistence, CV/document generation, profile mutation, approvals, connectors and external submission remain outside this delivery.

## Task lineage and review fixes

The preceding task commits and review-fix commits on this branch are:

- `337bcd3` `feat: add source-bound analysis revisions`; `a32e6bc` `fix: reject invalid revision timestamps`
- `d56995e` `feat: persist immutable analysis history`; `cde0ebf` `fix: harden analysis revision storage`
- `cf5ba48` `feat: define evidence-linked assessments`; `1f8a03f` `fix: align assessment evidence contracts`
- `8bd8172` `feat: bind and retain assessment snapshots`; `f5e279f` `fix: expose exact assessment bindings`
- `3c13978` `feat: expose local assessment workflow`; `78514d7` `fix: classify assessment repair states`; `acb1464` `test: cover assessment preflight states`
- `dae5041` `feat: show explainable assessments in job detail`; `1039778` `fix: preserve assessment evidence context`

Unrelated untracked M3 plans/reports and `.tmp-pr5-review/` were preserved.

## Final review fix — complete assessment snapshots (2026-09-12)

The final review fix closes the snapshot boundary at the profile-evidence artifact level. A ready match context now exposes `evidenceBindings`, a canonical sorted and duplicate-free array of `{ id, hash }` values covering every evidence artifact referenced by the selected profile revision. `MatchAssessment.profileRef.evidence` is required by the schema, copied byte-for-byte by `skills/assess-job/SKILL.md`, and checked at publication against both the selected revision and the current artifact bytes. A valid same-ID evidence replacement therefore makes an existing snapshot stale and cannot be published as an unchanged binding; missing, malformed, self-hash-invalid or inconsistent evidence is repair.

Freshness is now an explicit `current`/`stale`/`needs-repair` status. Current and historical assessment reads return a generic `409` for repair instead of a recommendation. The workspace summary preserves a repair marker without treating the assessment as readable. Private match-context responses set `Cache-Control: no-store`; a ready context receives a deterministic ETag, and the API accepts a validated `analysisRevision` alongside `profileRevision` for exact historical reads. The controller requests both saved IDs and the renderer accepts context only when analysis, profile and every evidence binding hash matches the saved assessment. Job detail also renders a compact, read-only assessment history list with escaped local inspection links and status labels.

### TDD RED evidence

The first focused draft of `tests/m4-final-review.test.ts` ran **6 tests: 1 passed, 5 failed** before the implementation changes. The failures were the intended contract gaps: ready context had no `evidenceBindings`; `profileRef.evidence` was rejected; a historical request returned the newer current analysis instead of the saved analysis; match-context responses lacked the required private cache header; and job detail had no assessment-history section. The sandboxed Node launcher separately hit the known Windows profile boundary (`EPERM: operation not permitted, lstat 'C:\\Users\\quanp'`) before discovery; authorized local execution supplied the RED and GREEN evidence.

### GREEN and verification evidence

| Gate | Result |
| --- | --- |
| Focused matching/context/storage/flow/UI suite, including `tests/m4-final-review.test.ts` | **46 passed, 0 failed, 0 skipped** |
| HTTP web-smoke suite | **59 passed, 0 failed, 0 skipped** |
| Complete registered `npm test` | **286 passed, 0 failed, 0 skipped** |
| Node built-in coverage over the registered paths plus the new focused file | **293 passed, 0 failed, 0 skipped** |
| `npm run build` | **passed** (`tsc`) |
| `pnpm audit --audit-level=high` | **no known vulnerabilities found** |
| `git diff --check` | **passed**; only LF/CRLF normalization warnings |

The package test script was left unchanged to preserve its explicit registered-file boundary; the new final-review regression file was run directly and included in the built-in coverage command. Coverage for the changed production surface was:

| Module | Lines | Branches | Functions |
| --- | ---: | ---: | ---: |
| `src/match/context.ts` | 97.81% | 86.87% | 100.00% |
| `src/match/schema.ts` | 100.00% | 82.93% | 100.00% |
| `src/match/storage.ts` | 94.10% | 85.32% | 92.00% |
| `src/match/policy.ts` | 97.17% | 83.87% | 100.00% |
| `src/web/server.ts` | 98.20% | 92.41% | 89.36% |
| `src/workspace/storage.ts` | 95.28% | 89.27% | 94.44% |
| `public/app.js` | 96.44% | 87.16% | 88.89% |
| `public/render.js` | 97.69% | 86.24% | 96.52% |

The focused regressions cover complete evidence-set binding, same-ID valid evidence replacement, current/stale/repair classification, corrupt profile pointers, exact historical analysis/profile context, no-store/ETag headers, generic repair responses and safe history rendering. Existing M3 opportunity-controller and race tests remain green. No M2 profile revision schema was changed, no legacy artifact was migrated, and unrelated untracked M3 plans/reports plus `.tmp-pr5-review/` remain untouched.

Manual browser verification remains **blocked**, not passed: the available in-app browser reports `IAB visibility is not supported in a subagent thread`, and hidden local-tab navigation is rejected by the client. Automated HTTP, renderer and controller evidence is the relied-on UI verification.

Residual risks remain limited to the documented local-only scope: semantic matching, provider execution, scores/ranking, ontology/equivalence, document generation, profile mutation, approvals, connectors, remote storage and external submission remain deferred. The new history links are read-only API inspection links; they do not add apply, mutation, score or provider actions.

## Final review fix round 1 — preserve earlier assessment revisions (2026-09-12)

New publishable assessments now use schemaVersion 2 and require `profileRef.evidence`. Stored schemaVersion 1 artifacts written before evidence bindings are parsed against their original shape, including their original contentHash calculation, and remain visible in history as unbound `needs-repair` records. Their ID, date, recommendation and artifact hash remain available for recovery; they are not treated as current or stale, no evidence hashes are invented, and new publication rejects them. A v1 current pointer gives current/detail consumers a generic repair response while the history route still returns the repair-marked entry.

### TDD RED/GREEN evidence

The new compatibility fixture was written before the stored parser existed, producing the expected module-load RED. Once parsing and storage support were present, the focused **49-test** run recorded **48 passed and 1 failed** because the history HTTP route still required a readable current assessment and returned `409`; the route was then narrowed to read history independently. The final focused run is **49 passed, 0 failed, 0 skipped**. The package test script now includes `tests/m4-final-review.test.ts`, protecting the seven existing final-review regressions and the two v1 compatibility regressions.

### Fresh verification

| Gate | Result |
| --- | --- |
| Registered `npm test` | **295 passed, 0 failed, 0 skipped** |
| Node built-in coverage over the registered paths | **295 passed, 0 failed, 0 skipped**; all files 97.15% line, 88.04% branch, 97.09% function |
| `npm run build` | **passed** (`tsc`) |
| `pnpm audit --audit-level=high` | **no known vulnerabilities found** |
| `git diff --check` | **passed**; LF/CRLF normalization warnings only |

Manual browser verification remains blocked by the unavailable subagent browser surface. No legacy artifact was migrated or rewritten, and unrelated untracked M3 plans/reports plus `.tmp-pr5-review/` remain preserved.

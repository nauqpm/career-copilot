# Final review fix report — bind complete assessment snapshots

**Date:** 2026-09-12
**Branch:** `feature/explainable-matching`
**Scope:** final review fixes for the bounded local explainable-matching flow
**Commit subject:** `fix: bind complete assessment snapshots`

## Outcome

The final review findings are addressed without changing the M2 profile revision schema or the M3 opportunity workflow. An assessment now binds the complete selected profile evidence artifact set, including the exact bytes currently used by the assessment producer. Freshness distinguishes valid staleness from repair, historical context loads exact saved revisions, private context responses are non-cacheable, and job detail exposes read-only assessment history.

The implementation remains local-only. No provider, browser automation, remote storage, database, score, apply action, approval action, profile mutation or external submission path was added.

## TDD evidence

### RED

The first focused draft added `tests/m4-final-review.test.ts` with six regressions. Before implementation, the authorized run reported:

- **6 tests, 1 passed, 5 failed**.
- `context.evidenceBindings` was absent from ready context.
- `profileRef.evidence` was rejected by the assessment schema.
- An exact historical request returned the newer current analysis rather than the saved analysis revision.
- Match-context responses lacked the required `Cache-Control: no-store` header.
- Job detail did not render an assessment-history section.

The direct sandboxed Node launcher also failed before test discovery with the known Windows user-profile boundary (`EPERM: operation not permitted, lstat 'C:\\Users\\quanp'`). It was not counted as a test result. All GREEN evidence below came from the authorized local runtime.

### GREEN

The focused suite grew to seven final-review tests and all passed. The final run also exercised the existing matching, analysis, storage, API, renderer and opportunity UI regressions.

## Fixes delivered

### Complete evidence snapshot binding

- Added `EvidenceBinding` and required `profileRef.evidence` to `MatchAssessment`.
- Enforced the existing profile-evidence namespace, lowercase SHA-256 hashes, strict ID ordering and duplicate rejection.
- Added `readProfileEvidenceWithHashes`, preserving parsed evidence content and returning the exact current artifact hashes separately.
- Added `MatchContext.evidenceBindings` for the ready context.
- Required save-time exact equality between the assessment bindings and every evidence artifact referenced by the selected profile revision.
- Added the same-ID valid replacement regression; it is accepted as a valid artifact but makes an old snapshot stale and cannot be published under the old binding.
- Updated `skills/assess-job/SKILL.md` to copy the caller-provided binding list byte-for-byte and never compute or invent hashes.

### Current, stale and repair state

- Replaced the ambiguous boolean freshness shape with `current`, `stale` and `needs-repair`.
- Valid newer profile, analysis, policy or evidence-byte inputs produce `stale` with reasons.
- Missing/corrupt capture, source, raw record, current pointer, selected analysis/profile revision or evidence produces `needs-repair`.
- Current and historical assessment endpoints return a generic `409` for repair and omit the assessment/recommendation.
- Workspace summary and renderer show repair state while suppressing a recommendation as usable.
- Added current-profile-pointer corruption coverage and retained source-byte corruption coverage.

### Private context and historical reads

- Added `Cache-Control: no-store` to every match-context path, including blocked and repair responses.
- Ready match context receives a deterministic ETag based on the locked analysis/profile/evidence/policy binding.
- Added validated `analysisRevision` query support beside `profileRevision`.
- Exact historical reads load the requested analysis and profile revisions and never fall back to current. Missing historical revisions block explicitly; corrupt historical artifacts return repair.
- The controller requests both IDs saved in the assessment and accepts context only when analysis ID/hash, profile ID/hash and the complete evidence-binding list all match.

### History UI

- Added a compact read-only history list to job detail.
- Each entry shows assessment ID, creation time, recommendation, status and active marker.
- Links are locally scoped, URL-encoded API inspection links and all displayed values are escaped.
- No mutation, apply, score, provider or submission behavior was introduced.
- Existing M3 opportunity drafts, confirmation tokens and route-race behavior remain untouched.

## Verification

| Check | Result |
| --- | --- |
| Focused matching/context/storage/flow/UI suite | **46 passed, 0 failed, 0 skipped** |
| HTTP web-smoke suite | **59 passed, 0 failed, 0 skipped** |
| Complete registered `npm test` | **286 passed, 0 failed, 0 skipped** |
| Node built-in coverage over registered paths plus final-review suite | **293 passed, 0 failed, 0 skipped** |
| `npm run build` | **passed** (`tsc`) |
| `pnpm audit --audit-level=high` | **no known vulnerabilities found** |
| `git diff --check` | **passed**; LF/CRLF normalization warnings only |

Coverage from the built-in reporter (line/branch/function):

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

The package test script was intentionally not edited. The new focused regression file was run explicitly and included in the coverage command; the complete registered suite remains separately verified at 286 passing tests.

## Compatibility and preservation

- M2 profile revision files and their schema were not changed.
- Legacy `analysis.json`, `decision.json`, `cv-draft.md` and legacy profile behavior remain read-compatible.
- Existing immutable source, analysis, profile, evidence and assessment bytes are not migrated, rewritten or relabelled.
- Unrelated untracked M3 plans/reports and `.tmp-pr5-review/` were not staged or modified.
- No push or external write was performed.

## Concerns and residual risks

Manual browser verification is **blocked**, not passed: the available Codex in-app browser reports `IAB visibility is not supported in a subagent thread`, and hidden local-tab navigation is client-blocked. Automated HTTP, renderer, controller and race tests provide the UI evidence.

The assessment remains an evidence-linked advisory snapshot, not a semantic matcher or submission authority. Provider/model execution, semantic equivalence, ontology, scores/ranking, salary/commute inference, document generation, profile mutation, approvals, connectors, database/remote storage and external submission remain intentionally deferred.

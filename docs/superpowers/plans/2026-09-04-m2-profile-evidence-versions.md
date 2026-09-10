# M2 Profile Evidence and Immutable Versions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let a candidate publish a reusable profile revision with local evidence while keeping every previously published revision readable and immutable.

**Architecture:** Keep the existing `data/profile/candidate-profile.json` as a readable legacy input and compatibility fixture. M2 adds `data/profile/revisions/<revision-id>.json`, `data/profile/evidence/<evidence-id>.json`, and `data/profile/current.json`; the current pointer is the only active-version selector. A publish writes validated evidence, then an immutable revision, then compares-and-replaces the pointer with the M1 shared artifact writer. Existing profile reads fall back to the legacy file when no pointer exists.

**Tech Stack:** Existing TypeScript, Node `fs/promises`/`crypto`/`http`, vanilla browser modules, `node:test` through the existing `tsx` script. No new dependency, database, network fetch, or agent runtime.

**Spec:** `docs/specs/local-it-career-workstation/04-profile-and-evidence.md` and sections 6.1–6.2 of `docs/specs/local-it-career-workstation/03-domain-model-and-artifact-contracts.md`; milestone exit criteria are in section 5 of `docs/specs/local-it-career-workstation/19-roadmap-and-milestones.md`.

## Global Constraints

- Keep workspace storage local; do not add accounts, cloud sync, multi-tenancy, hosted agents, or external fetches.
- Preserve raw source material, legacy profile files, old revisions, and unknown facts; never invent dates, titles, employers, qualifications, or outcomes.
- `CandidateProfile` remains the compatible base shape; `roleTracks` is optional free text and never a closed taxonomy.
- A candidate-confirmed manual evidence item quotes only the exact non-empty profile value it is attached to and is labelled `candidate-confirmed`/`user-asserted`.
- Evidence with `unverified` verification remains `needs-confirmation` and cannot be treated as supported.
- Exact-byte SHA-256 tokens and M1 `ConflictError`/safe-path/atomic-write rules are reused; no direct `writeFile` or unconditional overwrite is introduced.
- A failed pointer update may leave an unreferenced revision, but it must not change the prior active pointer or delete any evidence.
- All profile mutations require an observed version token; stale or busy writes return 409 and preserve the active revision.
- Browser drafts remain local, are retained after conflict, and require an explicit candidate confirmation before publish.
- Tests use disposable synthetic workspaces and must keep the project’s existing suite passing.

---

### Task 1: Add additive evidence and revision contracts

**Files:**
- Create: `src/profile/evidence.ts`
- Create: `src/profile/versions.ts`
- Modify: `src/profile/schema.ts`
- Test: `tests/profile-evidence.test.ts`
- Test: `tests/profile.test.ts`

**Interfaces:**
- `parseEvidenceItem(value: unknown): EvidenceItem`
- `parseEvidenceDraft(value: unknown): EvidenceDraft`
- `parseProfileRevision(value: unknown): ProfileRevision`
- `serializeProfileRevision(revision: ProfileRevision): string`
- `profileClaimPaths(profile: CandidateProfile): string[]`
- `type EvidenceItem = { schemaVersion: 1; id: string; createdAt: string; createdBy: { kind: "candidate" | "agent"; role?: string; skillVersion?: string }; contentHash: string; claim: string; claimType: EvidenceClaimType; source: { kind: EvidenceSourceKind; artifactId: string; locator: string }; quote: string; verification: EvidenceVerification; limitations?: string[]; language?: string }`
- `type ProfileRevision = { schemaVersion: 1; id: string; createdAt: string; createdBy: { kind: "candidate" }; contentHash: string; supersedes?: string; profile: CandidateProfile; claimEvidence: Array<{ claimPath: string; evidenceIds: string[]; status: "user-asserted" | "supported" | "needs-confirmation" }>; roleTracks?: string[] }`
- `type ProfileCurrentPointer = { schemaVersion: 1; revisionId: string; revisionHash: string }`

- [x] **Step 1: Write failing parser and hash tests.** Cover required IDs/timestamps/claims, allowed verification values, source locator values, evidence content-hash mismatch, revision profile validation, claim-path status, optional free-text role tracks, and preservation of Vietnamese/English strings.
- [x] **Step 2: Run focused tests to verify they fail.** Run `pnpm exec tsx --test tests/profile-evidence.test.ts tests/profile.test.ts`; expected failure is missing evidence/revision exports or rejected new `roleTracks` fixtures.
- [x] **Step 3: Implement the minimum contracts.** Parse and trim only fields already declared as text, validate `sha256:<64 lowercase hex>` tokens, recompute an envelope hash over the serialized object without its `contentHash`, and reject unknown enum/status values. Keep `CandidateProfile` fields additive and optional.
- [x] **Step 4: Run focused tests to verify they pass.** Run `pnpm exec tsx --test tests/profile-evidence.test.ts tests/profile.test.ts`; expect all focused tests to pass.

### Task 2: Persist immutable revisions and active pointer

**Files:**
- Modify: `src/profile/storage.ts`
- Modify: `src/profile/versions.ts`
- Test: `tests/profile-versions.test.ts`
- Test: `tests/profile.test.ts`

**Interfaces:**
- `type ProfileSnapshot = { profile?: CandidateProfile; hash: string | null; revision?: ProfileRevision; pointerHash?: string; legacy: boolean }`
- `readProfileSnapshot(root: string): Promise<ProfileSnapshot>`
- `readProfileHistory(root: string): Promise<{ current?: { revisionId: string; revisionHash: string }; revisions: Array<{ id: string; createdAt: string; supersedes?: string; revisionHash: string; evidenceCount: number; unresolvedCount: number; active: boolean }> }>`
- `publishProfileRevision(root: string, profile: CandidateProfile, expectedHash: string | null, options: { confirmed: boolean; evidence?: EvidenceDraft[]; roleTracks?: string[] }): Promise<{ profile: CandidateProfile; revision: ProfileRevision; revisionHash: string; unresolvedCount: number }>`
- `readCandidateProfile(root: string): Promise<CandidateProfile | undefined>` continues to return the active revision profile, then legacy profile when no pointer exists.

- [x] **Step 1: Write failing persistence tests.** Cover first publish from a legacy file, generated candidate-confirmed evidence for every non-empty profile leaf, explicit unverified evidence staying unresolved, two revisions with `supersedes`, current-pointer selection, history summaries, stale hash conflict, held lock conflict, malformed pointer/revision isolation, and a failed pointer update leaving the prior pointer/revision readable.
- [x] **Step 2: Run focused persistence tests to verify they fail.** Run `pnpm exec tsx --test tests/profile-versions.test.ts`; expected failure is missing snapshot/publish/history functions.
- [x] **Step 3: Implement persistence with M1 primitives.** Read and validate the pointer and referenced revision, use the legacy artifact hash when importing the first profile, generate only candidate-confirmed evidence from exact profile leaf values when no drafts are supplied, write evidence with create-only semantics, write the revision with a generated UUID, and update `current.json` using its own pointer hash as the compare token. Never rewrite `candidate-profile.json` during publish.
- [x] **Step 4: Run focused persistence tests to verify they pass.** Run `pnpm exec tsx --test tests/profile-versions.test.ts`; expect all persistence tests to pass and confirm old revisions’ bytes do not change.

### Task 3: Expose publish/history through CLI and HTTP

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/web/server.ts`
- Modify: `package.json`
- Test: `tests/m2.test.ts`
- Test: `tests/profile-form.test.ts`
- Test: `tests/workspace.test.ts`

**Interfaces:**
- CLI command: `career profile publish <profile.json> --root <workspace> --confirm [--expected-hash sha256:<64 lowercase hex>]`
- `GET /api/profile` returns the active profile and its exact revision/legacy ETag.
- `GET /api/profile/history` returns `{ current, revisions }`.
- `GET /api/profile/revisions/:id` returns a validated immutable revision and its exact revision ETag.
- `POST /api/profile/publish` accepts `{ profile, confirmed, evidence?, roleTracks? }`, requires `confirmed: true` and `If-Match`, and returns `{ profile, revision, unresolvedCount }` with the new revision ETag.
- Existing `PUT /api/profile` remains a compatibility alias that validates the profile, treats the request as an explicit candidate-confirmed publish, and returns the profile body plus the new ETag.
- `/api/summary` adds `profileRevision`, `profileHistory`, and `unresolvedClaims` while retaining `profile`, `profileHash`, `profileSourceHash`, and contained corruption errors.

- [x] **Step 1: Write failing API/CLI tests.** Cover missing confirmation/token (428), invalid profile/evidence (400), stale publish (409), history and revision ETags, first publish from legacy profile, CLI confirmation/expected-hash handling, and no mutation after rejected requests.
- [x] **Step 2: Run focused API/CLI tests to verify they fail.** Run `pnpm exec tsx --test tests/m2.test.ts tests/profile-form.test.ts tests/workspace.test.ts`; expected failures are missing route/command and missing summary fields.
- [x] **Step 3: Implement the routes and command.** Reuse `readProfileSnapshot`/`publishProfileRevision`, keep error envelopes generic, validate body before filesystem writes, set quoted ETags from exact snapshot hashes, and avoid rereading after publish when constructing the response.
- [x] **Step 4: Run focused API/CLI tests to verify they pass.** Run `pnpm exec tsx --test tests/m2.test.ts tests/profile-form.test.ts tests/workspace.test.ts` and confirm all existing M1 behaviours remain green.

### Task 4: Add candidate confirmation and evidence status to the dashboard

**Files:**
- Modify: `public/app.js`
- Modify: `public/render.js`
- Modify: `public/profile-form.js`
- Test: `tests/web-smoke.test.ts`
- Test: `tests/profile-form.test.ts`

**Interfaces:**
- Profile summary renders active revision ID/date, evidence count, unresolved count, and a history list without displaying raw credentials or full source documents.
- Profile edit forms include a required confirmation checkbox; submit sends `POST /api/profile/publish` with the original profile `If-Match` and retains the draft on 409/428.
- A confirmed publish response updates the active profile and history without replacing an in-progress draft from a newer refresh.
- Unverified evidence is labelled `Cần xác nhận`; candidate-confirmed evidence is labelled `Bạn đã xác nhận`; no status is represented as supported without a validated evidence mapping.

- [x] **Step 1: Write failing browser tests.** Cover confirmation required before publish, revision/history rendering, unresolved evidence label, stale publish draft retention after refresh, and the fact that the browser sends no network request except the local server origin.
- [x] **Step 2: Run focused browser tests to verify they fail.** Run `pnpm exec tsx --test tests/web-smoke.test.ts tests/profile-form.test.ts`; expected failures are missing confirmation markup, publish route, and history rendering.
- [x] **Step 3: Implement the smallest UI flow.** Add the checkbox and status summary to the existing profile folders, preserve the original edit token, call the new publish endpoint, escape every revision/evidence string, and keep raw source content out of summaries and logs.
- [x] **Step 4: Run focused browser tests to verify they pass.** Run `pnpm exec tsx --test tests/web-smoke.test.ts tests/profile-form.test.ts`; expect all focused tests to pass.

### Task 5: Document compatibility, recovery and bilingual/free-text boundaries

**Files:**
- Modify: `README.md`
- Modify: `docs/specs/local-it-career-workstation/04-profile-and-evidence.md`
- Modify: `docs/specs/local-it-career-workstation/19-roadmap-and-milestones.md`
- Create: `reports/m2-profile-evidence-versions.md`

- [x] **Step 1: Document the stored paths and workflow.** Explain legacy fallback, explicit publish, current pointer, immutable revisions, evidence statuses, candidate confirmation, Vietnamese/English source handling, free-text role tracks, and manual recovery of an orphan revision/pointer.
- [x] **Step 2: Mark the M2 delivery record.** Link the report from the roadmap and keep PDF/GitHub fetching, salary restructuring, M3 provenance, and M4 matching explicitly deferred.
- [x] **Step 3: Review links and wording.** Run a local Markdown link check over changed docs and verify no document calls proposed M3/M4 behaviour implemented.

### Verification and finish

- [x] Run `pnpm test` and confirm the full suite has zero failures and zero skips.
- [x] Run `pnpm build` and confirm TypeScript exits 0.
- [x] Run the combined coverage command used by M1 and record actual lines/branches/functions.
- [x] Run the local browser synthetic-workspace smoke flow for profile confirmation, revision history, stale conflict retention, corruption isolation, and no external requests.
- [x] Run `git diff --check` and inspect `git diff main...HEAD` for secrets, private data, schema surprises, and unrelated scope.
- [x] Request an independent correctness/security review, fix actionable findings, rerun affected tests, and record the result in `reports/m2-profile-evidence-versions.md`.
- [x] Update every completed checkbox in this plan only after the corresponding command has passed. Do not commit, push, or merge as part of M2 unless separately requested.

# M4 Explainable Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the candidate publish a source-bound job analysis, compare it with one exact published profile revision, and inspect an immutable evidence-linked assessment whose freshness can be verified locally.

**Architecture:** Extend the existing local-file architecture with two independent immutable revision streams under each job: `analyses/` and `assessments/`, each selected by a hash-checked `current.json` pointer. Codex skills continue to perform semantic extraction and matching; TypeScript owns validation, exact source/profile/policy binding, safe persistence, staleness, and presentation. Existing `analysis.json` and `decision.json` remain readable legacy artifacts and are never silently relabelled, migrated, or overwritten.

**Tech Stack:** Existing TypeScript, Node.js `fs/promises`/`crypto`/`http`, vanilla browser modules, and `node:test` through `tsx`. No production dependency, database, network provider, worker, agent framework, or migration runtime.

**Spec:** `docs/specs/local-it-career-workstation/06-explainable-matching.md`, constrained by the accepted first-release list in `docs/specs/local-it-career-workstation/27-m0-baseline-and-delivery-inventory.md`; source/profile contracts come from `03-domain-model-and-artifact-contracts.md`, `04-profile-and-evidence.md`, and the delivered M3 capture contract.

**Execution contract:** Implement Tasks 1–7 sequentially on the single branch `feature/explainable-matching`. Every implementer and reviewer subagent uses `gpt-5.6-luna` with reasoning effort `max`, the highest effort this runtime supports for Luna (the requested `ultra` setting is rejected by the host). Each task updates `report.md` with its exact RED/GREEN and regression evidence and creates one conventional commit before task review. Branch names, commit subjects, PR title/body, and user-facing delivery text must not contain the strings `codex` or `m4` in any letter case. Push only after the final whole-branch review and fresh verification pass; do not create a remote PR unless the user separately requests it.

## Global Constraints

- Scope is one verified local JD capture, one immutable analysis revision, one published profile revision, and one global matcher policy `m4-v1`.
- Preserve exact JD source bytes, profile evidence, legacy `analysis.json`/`decision.json`, and all old revisions. No silent migration or backfill.
- Every positive or conflicting assessment cites a stable requirement ID and at least one validated profile evidence ID; missing evidence is `not-evidenced` or `unknown`, never a fabricated gap.
- Requirement modality remains `required`, `preferred`, or `unknown`; no percentage, weighted score, hidden ranking, synonym ontology, or technology equivalence engine.
- Preferences come from the selected profile revision. Free-form notes are displayed as candidate context only and do not become automatic hard blockers.
- `blocked` is a preflight/context result for missing or corrupt inputs, not a persisted assessment with incomplete provenance.
- Persisted recommendations are `consider`, `clarify`, or `not-ready`; they are advisory and grant no document, approval, archive, or submission authority.
- The global policy is checked-in code/data with version `m4-v1`. Role-family policy, saved custom policies, salary conversion, commute estimation, and anomaly overrides are deferred.
- Skills produce proposals only. The CLI/server validate all IDs, hashes, timestamps, references, quotes, and current-pointer expectations before writing.
- Reuse M1 `readArtifact`/`writeArtifact`, safe-path checks, atomic create-only writes, and optimistic conflict behavior. A failed pointer update may leave a valid orphan revision but must not change the prior current revision.
- Tests use synthetic temporary workspaces only. Do not read or mutate private career data.
- Preserve the unrelated untracked M3 plans/reports and `.tmp-pr5-review/` currently in the worktree.

## Locked M4 Contract Decisions

1. Spec 06 is canonical for assessment terminology: `recommendation`, `requirementAssessments`, `preferenceChecks`, `blockers`, `questions`, and `anomalies`. M4 adds the common artifact envelope and exact input hashes required by spec 03.
2. A new analysis is an immutable `JobAnalysisRevision`; the legacy flat `analysis.json` remains compatibility-only and cannot be selected as an M4 input.
3. A requirement locator is byte-independent and auditable: `{ start: number; end: number; quote: string }` indexes JavaScript string offsets in the exact `source.md` content. Validation requires `source.slice(start, end) === quote`.
4. Preferences remain embedded in the selected profile revision, so its revision hash is their version lock. There is no separate `preferenceVersionId` in M4.
5. Agent metadata is truthful and producer-supplied: role, skill version, prompt template hash, and model label are required; the local validator never invents a model name or claims a provider run.
6. Each stream uses an immutable artifact plus current pointer. Updating a pointer requires its observed hash; the first write uses the explicit missing token supported by the shared writer.

## File and Interface Map

**Create**

- `src/job/analysis-revisions.ts` — source-bound analysis envelope, parser, hashes, requirement IDs and locators.
- `src/job/analysis-storage.ts` — publish/read/history for immutable analyses and their current pointer.
- `src/match/policy.ts` — global `m4-v1` policy identity and deterministic structural rules only.
- `src/match/schema.ts` — assessment types, parser and content hash.
- `src/match/context.ts` — load one exact healthy capture, analysis revision, profile revision and evidence set; report preflight blockers.
- `src/match/storage.ts` — validate references, save/read/history assessments, and compute freshness.
- `tests/job-analysis-revisions.test.ts`, `tests/job-analysis-storage.test.ts`, `tests/match-schema.test.ts`, `tests/match-context.test.ts`, `tests/match-storage.test.ts`, `tests/m4-matching-flow.test.ts`.

**Modify**

- `skills/analyze-job/SKILL.md` — output a source-bound analysis draft with locators and stable requirement IDs.
- `skills/assess-job/SKILL.md` — consume only the locked M4 context and output an assessment draft; remove CV creation from this M4 path.
- `src/cli.ts` — add analysis publish/context and match context/validate/publish commands while retaining legacy commands.
- `src/workspace/storage.ts` — expose current M4 analysis/assessment summaries additively; retain legacy fields.
- `src/web/server.ts` — read-only context/history endpoints and assessment detail; no model execution.
- `public/app.js`, `public/render.js`, `public/styles.css` — render current assessment, history/freshness and remediation on the existing job detail route.
- `package.json` — register M4 tests without adding dependencies.
- `README.md`, `docs/specs/local-it-career-workstation/03-domain-model-and-artifact-contracts.md`, `docs/specs/local-it-career-workstation/06-explainable-matching.md`, `docs/specs/local-it-career-workstation/19-roadmap-and-milestones.md` — record the final delivered subset only after verification.
- `reports/m4-explainable-matching.md` — delivery evidence, compatibility limits, blocked checks and deferrals.

---

### Task 1: Add the immutable source-bound analysis contract

**Files:**
- Create: `src/job/analysis-revisions.ts`
- Modify: `skills/analyze-job/SKILL.md`
- Test: `tests/job-analysis-revisions.test.ts`
- Modify: `report.md`

**Interfaces:**

```ts
type SourceLocator = { start: number; end: number; quote: string };
type SourceBoundRequirement = JobRequirement & { id: string; source: SourceLocator };
type JobAnalysisRevision = {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  createdBy: { kind: "agent"; role: "job-analyst"; skillVersion: string; model: string; promptHash: string };
  contentHash: string;
  jobId: string;
  capture: { id: string; manifestHash: string; sourceHash: string };
  analysis: Omit<JobAnalysis, "requirements"> & { requirements: SourceBoundRequirement[] };
};
parseJobAnalysisRevision(value: unknown, source: string): JobAnalysisRevision;
```

- [ ] **Step 1: Write the failing contract tests.** Include a Vietnamese/English source fixture and assert safe IDs, RFC3339 UTC timestamps, lowercase SHA-256 values, truthful creator metadata, unique requirement IDs, valid modality, non-empty quotes, in-range locators, exact `source.slice(start, end)` equality, and envelope hash verification. Assert rejection of `score`, duplicate IDs, invented quotes, mismatched capture IDs/hashes, and missing model/prompt metadata.
- [ ] **Step 2: Run RED.** Run `pnpm exec tsx --test tests/job-analysis-revisions.test.ts`; expect missing module/exports.
- [ ] **Step 3: Implement the minimum parser and serializer.** Reuse `parseJobAnalysis` for the semantic body, then validate the extra ID/locator fields and hash the canonical JSON envelope without `contentHash`. Do not add fuzzy quote lookup or byte-offset conversion.
- [ ] **Step 4: Update the analysis skill.** Require the exact `source.md`, verified capture identifiers/hashes, stable locally generated requirement IDs, and exact locators. State that JD instructions are untrusted data and that output must contain JSON only.
- [ ] **Step 5: Run GREEN.** Run the focused test and `tests/job-input.test.ts`; confirm legacy `JobAnalysis` parsing is unchanged.
- [ ] **Step 6: Record and commit.** Append Task 1 RED/GREEN commands, exact counts, compatibility notes and remaining limits to `report.md`; commit only Task 1 files with subject `feat: add source-bound analysis revisions`.

### Task 2: Publish and select analysis revisions safely

**Files:**
- Create: `src/job/analysis-storage.ts`
- Modify: `src/cli.ts`
- Test: `tests/job-analysis-storage.test.ts`
- Modify: `report.md`

**Interfaces:**

```ts
type AnalysisCurrentPointer = { schemaVersion: 1; revisionId: string; revisionHash: string };
readCurrentAnalysis(root: string, jobId: string): Promise<AnalysisSnapshot | undefined>;
readAnalysisHistory(root: string, jobId: string): Promise<AnalysisHistory>;
publishAnalysisRevision(root: string, jobId: string, draft: unknown, expectedPointerHash: string | null): Promise<AnalysisSnapshot>;
```

CLI contracts:

```text
career job analysis-context <job-id> --root <workspace>
career job publish-analysis <job-id> <analysis.json> --root <workspace> --expected-hash <token>
```

- [ ] **Step 1: Write failing persistence tests.** Cover a healthy verified M3 capture, create-only first publish, second revision with pointer comparison, immutable old bytes, stale pointer conflict, corrupted/dangling pointer, malformed orphan isolation, and refusal for legacy/missing/changed source manifests.
- [ ] **Step 2: Run RED.** Run `pnpm exec tsx --test tests/job-analysis-storage.test.ts`; expect missing storage functions and CLI commands.
- [ ] **Step 3: Implement publish order.** Re-read and verify `source.md`, `source.json`, and `raw.json`; validate the draft against exact source bytes; write `analyses/<id>.json` create-only; then compare-and-write `analyses/current.json`. Never write `analysis.json`.
- [ ] **Step 4: Implement the CLI handoff.** `analysis-context` prints only the selected job/capture/source binding needed by the skill. `publish-analysis` validates before writing and reports the revision ID/hash; it does not call a model.
- [ ] **Step 5: Run GREEN.** Run the focused tests plus `tests/job-capture.test.ts` and `tests/m3-opportunity-flow.test.ts`; confirm capture and opportunity bytes are unchanged.
- [ ] **Step 6: Record and commit.** Append Task 2 evidence to `report.md`; commit only Task 2 files with subject `feat: persist immutable analysis history`.

### Task 3: Define the M4 assessment schema and global policy

**Files:**
- Create: `src/match/policy.ts`
- Create: `src/match/schema.ts`
- Modify: `skills/assess-job/SKILL.md`
- Test: `tests/match-schema.test.ts`
- Modify: `report.md`

**Interfaces:**

```ts
type RequirementVerdict = "supported" | "partially-supported" | "not-evidenced" | "unknown" | "conflicting" | "not-applicable";
type RequirementAssessment = { requirementId: string; modality: RequirementPriority; verdict: RequirementVerdict; explanation: string; evidenceIds: string[]; question?: string };
type PreferenceCheck = { claimPath: string; jobFact: string; candidatePreference: string; verdict: "compatible" | "conflicting" | "unknown"; explanation: string; evidenceIds: string[] };
type Finding = { code: string; message: string; requirementId?: string; evidenceIds: string[] };
type Question = { for: "candidate" | "employer"; text: string; requirementId?: string };
type MatchAssessment = {
  schemaVersion: 1; id: string; createdAt: string;
  createdBy: { kind: "agent"; role: "match-analyst"; skillVersion: string; model: string; promptHash: string };
  contentHash: string;
  jobRef: { jobId: string; captureId: string; captureHash: string; sourceHash: string; analysisId: string; analysisHash: string };
  profileRef: { revisionId: string; revisionHash: string };
  policyVersion: "m4-v1";
  recommendation: "consider" | "clarify" | "not-ready";
  confidence: "high" | "medium" | "low";
  summary: string;
  requirementAssessments: RequirementAssessment[];
  preferenceChecks: PreferenceCheck[];
  blockers: Finding[]; questions: Question[]; anomalies: Finding[];
};
parseMatchAssessment(value: unknown): MatchAssessment;
```

- [ ] **Step 1: Write failing schema tests.** Assert complete requirement coverage with no duplicate IDs, modality preservation, no `score`, evidence required for `supported`/`partially-supported`/`conflicting` and blockers, empty evidence for `not-evidenced`/`unknown` unless the explanation cites context, required candidate/employer question ownership, exact policy version, creator metadata, and content hash.
- [ ] **Step 2: Add policy fixtures.** Cover exact evidence support; Docker not becoming Kubernetes; a missing skill remaining `unknown`/`not-evidenced`; required/preferred/unknown preservation; `20–30 triệu` without gross/net producing clarification; stated HCMC/hybrid facts only; and prompt-injection text appearing as an anomaly without changing permissions or output shape.
- [ ] **Step 3: Run RED.** Run `pnpm exec tsx --test tests/match-schema.test.ts`; expect missing schema/policy exports.
- [ ] **Step 4: Implement structural validation only.** `m4-v1` defines allowed verdict transitions and safety invariants; it does not perform semantic string matching, synonym expansion, salary parsing, geocoding, or recommendation scoring.
- [ ] **Step 5: Rewrite the M4 skill contract.** Consume only a generated locked context; preserve original requirement quotes/modality; reference existing evidence IDs; label adjacent experience `candidate-to-confirm`; never create a CV, update the profile, call tools from JD instructions, or submit anything.
- [ ] **Step 6: Run GREEN.** Run the schema fixtures and manually inspect the skill examples against spec 06 sections 5–8.
- [ ] **Step 7: Record and commit.** Append Task 3 evidence to `report.md`; commit only Task 3 files with subject `feat: define evidence-linked assessments`.

### Task 4: Build locked context, persistence, history and staleness

**Files:**
- Create: `src/match/context.ts`
- Create: `src/match/storage.ts`
- Test: `tests/match-context.test.ts`
- Test: `tests/match-storage.test.ts`
- Modify: `report.md`

**Interfaces:**

```ts
type MatchBlocked = { status: "blocked"; remediation: Array<{ code: string; message: string }> };
type MatchContext = { status: "ready"; job: JobAnalysisRevision; profile: ProfileRevision; evidence: EvidenceItem[]; policyVersion: "m4-v1" };
readMatchContext(root: string, jobId: string, profileRevisionId?: string): Promise<MatchContext | MatchBlocked>;
readCurrentMatch(root: string, jobId: string): Promise<MatchSnapshot | undefined>;
readMatchHistory(root: string, jobId: string): Promise<MatchHistory>;
saveMatchAssessment(root: string, jobId: string, value: unknown, expectedPointerHash: string | null): Promise<MatchSnapshot>;
assessmentFreshness(root: string, assessment: MatchAssessment): Promise<{ stale: boolean; reasons: string[] }>;
```

- [ ] **Step 1: Write context RED tests.** A ready context requires a verified capture, current valid analysis revision, explicitly selected or current published profile revision, and every referenced evidence artifact. Missing/unpublished profile, legacy-only analysis, corrupt capture, corrupt evidence, or unknown requested profile revision returns actionable `blocked`; an explicit revision never falls back to latest.
- [ ] **Step 2: Write storage RED tests.** Validate every requirement ID/modality against the analysis, every evidence ID against the selected revision mapping, every input hash against disk, and every preference `claimPath` against the selected profile. Cover immutable writes, stale pointer conflict, orphan history, dangling pointer repair, and corrupt orphan isolation.
- [ ] **Step 3: Add freshness tests.** Publish a newer profile, analysis, or policy and assert the prior assessment becomes stale without byte changes. Changed/corrupt capture/source is a repair condition, not a silently refreshed assessment.
- [ ] **Step 4: Run RED.** Run `pnpm exec tsx --test tests/match-context.test.ts tests/match-storage.test.ts`; expect missing modules.
- [ ] **Step 5: Implement with existing storage primitives.** Load exact IDs before semantic validation, fail closed on a bad current pointer, list valid orphan history separately, and advance `assessments/current.json` only after a complete assessment passes reference checks.
- [ ] **Step 6: Run GREEN.** Run both focused files and the M2/M3 storage suites; confirm no profile, capture, opportunity, legacy analysis, or legacy decision bytes change.
- [ ] **Step 7: Record and commit.** Append Task 4 evidence to `report.md`; commit only Task 4 files with subject `feat: bind and retain assessment snapshots`.

### Task 5: Add CLI and read-only HTTP workflow

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/workspace/storage.ts`
- Modify: `src/web/server.ts`
- Test: `tests/m4-matching-flow.test.ts`
- Test: `tests/workspace.test.ts`
- Modify: `report.md`

**Interfaces:**

```text
career match context <job-id> --root <workspace> [--profile-revision <id>]
career match validate <assessment.json>
career match publish <job-id> <assessment.json> --root <workspace> --expected-hash <token>

GET /api/jobs/:id/match-context?profileRevision=<id>
GET /api/jobs/:id/assessments
GET /api/jobs/:id/assessments/current
GET /api/jobs/:id/assessments/:assessmentId
```

- [ ] **Step 1: Write failing CLI/API tests.** Cover ready/blocked context, exact profile selection, validate-without-write, publish conflict/no-mutation, quoted ETags, current/history/detail reads, 404 for absence, 409 for repair, and generic error envelopes that do not expose absolute paths or profile content.
- [ ] **Step 2: Run RED.** Run `pnpm exec tsx --test tests/m4-matching-flow.test.ts tests/workspace.test.ts`; expect missing commands/routes.
- [ ] **Step 3: Implement local handoff commands.** Context emits a minimal JSON bundle for the skill; validate parses structure; publish revalidates live references and writes locally. None invokes an AI provider.
- [ ] **Step 4: Implement read APIs and additive job summaries.** Expose assessment freshness/history while keeping `analysis`, `decision`, `decisionStatus`, M3 grouping, and existing route bodies backward-compatible. Do not add a browser authoring endpoint in M4.
- [ ] **Step 5: Run GREEN.** Run focused tests plus all existing CLI, workspace, profile and opportunity API tests.
- [ ] **Step 6: Record and commit.** Append Task 5 evidence to `report.md`; commit only Task 5 files with subject `feat: expose local assessment workflow`.

### Task 6: Present explainable matching on the existing job detail page

**Files:**
- Modify: `public/app.js`
- Modify: `public/render.js`
- Modify: `public/styles.css`
- Test: `tests/opportunity-ui.test.ts`
- Test: `tests/web-smoke.test.ts`
- Test: `tests/m4-matching-flow.test.ts`
- Modify: `report.md`

**Interfaces:**

- Snapshot header shows analysis/profile revision, generation date and `current`/`stale`/`needs-repair` state.
- Assessment order is recommendation → requirement table → preference checks → blockers/anomalies/questions → local rerun instructions.
- Requirement rows show original quote, modality, verdict, explanation and evidence IDs/claim paths.
- Legacy `decision.json` remains visible as `Đánh giá cũ — chưa khóa phiên bản` only when no M4 current assessment exists.

- [ ] **Step 1: Write failing render tests.** Cover Vietnamese labels, escaping untrusted JD/profile text, all verdicts/modalities, evidence links, stale reasons, blocked remediation, legacy-only display, missing assessment, and absence of a fit percentage or `Apply` action.
- [ ] **Step 2: Write controller race tests.** A late assessment response from a prior job/route must not overwrite the current view; refresh must preserve the M3 opportunity form draft and its confirmation binding.
- [ ] **Step 3: Run RED.** Run `pnpm exec tsx --test tests/opportunity-ui.test.ts tests/web-smoke.test.ts tests/m4-matching-flow.test.ts`; expect missing assessment UI.
- [ ] **Step 4: Implement the smallest read/review UI.** Reuse the existing job-detail route and request/race guards. Render IDs and short evidence labels, not entire profile source documents. Rerun remains an explicit Codex/CLI instruction.
- [ ] **Step 5: Run GREEN.** Run the focused browser/controller tests and confirm M3 grouping behavior still passes.
- [ ] **Step 6: Record and commit.** Append Task 6 evidence to `report.md`; commit only Task 6 files with subject `feat: show explainable assessments in job detail`.

### Task 7: Complete acceptance, compatibility documentation and review

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/specs/local-it-career-workstation/03-domain-model-and-artifact-contracts.md`
- Modify: `docs/specs/local-it-career-workstation/06-explainable-matching.md`
- Modify: `docs/specs/local-it-career-workstation/19-roadmap-and-milestones.md`
- Create: `reports/m4-explainable-matching.md`
- Modify: `report.md`

- [ ] **Step 1: Register the six M4 test files.** Keep the explicit existing test list; do not add a runner dependency.
- [ ] **Step 2: Execute the end-to-end synthetic flow.** Capture a JD → publish source-bound analysis → publish profile/evidence → create locked context → validate/publish assessment → inspect UI → publish a new profile → observe stale → publish a replacement assessment. Assert every prior artifact byte is unchanged.
- [ ] **Step 3: Run all gates.** Run `pnpm test`, `pnpm build`, the existing Node coverage command with at least 80% statements/branches/functions/lines for new M4 modules, `git diff --check`, and the project security/privacy checks. Record exact pass/fail/skip counts and environmental blockers; do not borrow old report results.
- [ ] **Step 4: Perform browser verification.** Use a synthetic workspace to inspect narrow/wide layouts, keyboard focus, requirement-table readability, stale/repair messages and the absence of external requests. Record any browser/tool limitation as blocked, never passed.
- [ ] **Step 5: Request independent correctness and security review.** Prioritize source-locator forgery, evidence-ID escalation, stale hashes, pointer corruption, path traversal, prompt injection, private-data leakage and M3 UI regressions. Fix each actionable finding and rerun affected gates.
- [ ] **Step 6: Update delivery docs only after evidence exists.** Mark only the bounded M4 subset delivered. Document legacy compatibility, manual skill handoff, recovery of orphan/dangling revisions, and all deferrals below.
- [ ] **Step 7: Inspect scope before any commit.** Review only M4 paths, preserve all unrelated untracked files, scan for secrets/private fixtures, and use conventional task-scoped commits only if the user separately asks to commit.
- [ ] **Step 8: Record and commit.** Append final suite/build/coverage/browser/review evidence to `report.md`; commit only Task 7 documentation and test-registration changes with subject `docs: record explainable matching delivery`.

## Explicit Deferrals

- Automatic local or remote model invocation, provider selection, consent/egress UI, MCP, hosted agents, and background workers.
- Semantic synonym/ontology engine, role-family policies, ranking/percentage scores, automatic equivalence, or learning from outcomes.
- Numeric salary conversion, gross/net inference, tax/legal advice, commute estimation, geocoding, and guessed HCMC district data.
- Saved custom constraint policies and automatic use of free-form notes as hard blockers.
- Browser assessment authoring, anomaly override, archive/pursue state, CV/document creation, approval, application submission, connectors, analytics, and coaching.
- Silent conversion of legacy `analysis.json` or `decision.json`. A future explicit import tool may preview and publish them only with source/reference validation and candidate confirmation.

## Execution Order and Review Gates

Execute Tasks 1–7 sequentially. Tasks 1–2 establish trustworthy job inputs; Tasks 3–4 establish trustworthy assessments; Tasks 5–6 expose the local workflow; Task 7 is the release gate. After each task, review the actual diff and its focused tests before moving on. Do not begin M5, commit, push, merge, or create a remote PR without separate authorization.

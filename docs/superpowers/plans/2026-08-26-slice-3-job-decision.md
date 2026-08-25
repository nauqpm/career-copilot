# Slice 3 — Job Decision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a traceable, no-score job decision and a separate Markdown CV draft for each JD.

**Architecture:** `JobDecision` is a strict derived-file contract. Codex reads one validated profile and one validated job analysis, then writes `decision.json` and optional `cv-draft.md` in that job directory; Slice 4 only displays these artifacts.

**Tech Stack:** TypeScript, Node.js standard library, `tsx`, `node:test`, Markdown.

**Spec:** `docs/superpowers/specs/2026-08-25-career-copilot-slices-2-4-design.md`

## Global Constraints

- Create branch `slice-3-job-decision` from the completed Slice 2 branch.
- Every conclusion cites explicit job/profile text, or is a question. Never use a fit percentage.
- Derived files never overwrite source JD text, raw JSON, or `candidate-profile.json`.
- Keep all commits local; no application submission, UI, or automation in this Slice.

---

## File structure

| Path | Responsibility |
|---|---|
| `src/decision/schema.ts` | Decision types and parser. |
| `src/decision/storage.ts` | Safe, atomic derived-artifact writes. |
| `src/cli.ts` | `career decision validate` dispatch. |
| `skills/assess-job/SKILL.md` | Manual Codex comparison/drafting rules. |
| `tests/decision.test.ts` | Parser, storage isolation, and CLI tests. |
| `reports/slice-3-job-decision.md` | Verified completion report. |

## Contract

```ts
export type DecisionStatus = "consider" | "clarify" | "not-ready";
export type DecisionEvidence = { topic: string; finding: string; jobEvidence?: string; profileEvidence?: string };
export type JobDecision = {
  status: DecisionStatus;
  summary: string;
  matches: DecisionEvidence[];
  gaps: DecisionEvidence[];
  blockers: DecisionEvidence[];
  questions: string[];
  cvDraftRecommendation: "create" | "hold";
};
export function parseJobDecision(value: unknown): JobDecision;
export async function saveJobDecision(directory: string, value: JobDecision): Promise<void>;
export async function saveCvDraft(directory: string, markdown: string): Promise<void>;
```

### Task 1: Decision schema and parser

**Files:** Create `src/decision/schema.ts`, `tests/decision.test.ts`.

**Interfaces:** Produces `parseJobDecision` used by storage, CLI, skills, and the later UI.

- [ ] **Step 1: Write failing parser tests.**

```ts
test("parses a considered job with evidence and a CV recommendation", () => {
  const result = parseJobDecision({
    status: "consider", summary: "Relevant backend work is present.",
    matches: [{ topic: "TypeScript", finding: "Relevant experience", jobEvidence: "TypeScript required", profileEvidence: "Built TypeScript APIs" }],
    gaps: [], blockers: [], questions: ["Confirm salary"], cvDraftRecommendation: "create",
  });
  assert.equal(result.cvDraftRecommendation, "create");
});
test("rejects scores, invalid states, and evidence without a finding", () => {
  assert.throws(() => parseJobDecision({ status: "92%" }), /status/);
  assert.throws(() => parseJobDecision(validDecision({ matches: [{ topic: "English" }] })), /finding/);
});
```

- [ ] **Step 2: Run `pnpm exec tsx --test tests/decision.test.ts`; confirm it fails because the decision parser is missing.**
- [ ] **Step 3: Implement strict parsing.** Require all evidence lists, summary, status, and recommendation; trim all strings; require at least one job/profile evidence string for every match; allow a gap/blocker with no evidence only when it is an explicit unknown; reject numbers and extra score fields.
- [ ] **Step 4: Run `pnpm test` and `pnpm build`; commit:** `feat: add job decision validation`.

### Task 2: Derived storage, CLI, and skill

**Files:** Create `src/decision/storage.ts`, `skills/assess-job/SKILL.md`; modify `src/cli.ts`, `README.md`, `tests/decision.test.ts`.

**Interfaces:** Consumes the Candidate Profile and Job Analysis contracts; produces derived files only in an explicit job directory.

- [ ] **Step 1: Add failing storage/CLI tests.** Define `validDecision(): JobDecision` in the test file as a fully populated valid fixture, then write:

```ts
test("saves decision and CV draft only below its job directory", async () => {
  await mkdir(join(root, "data", "profile"), { recursive: true });
  await writeFile(join(root, "data", "profile", "candidate-profile.json"), JSON.stringify(profileFixture));
  await saveJobDecision(jobDirectory, validDecision());
  await saveCvDraft(jobDirectory, "# Tailored CV\n");
  assert.equal(await readFile(join(jobDirectory, "cv-draft.md"), "utf8"), "# Tailored CV\n");
  assert.equal(await readFile(join(root, "data", "profile", "candidate-profile.json"), "utf8"), JSON.stringify(profileFixture));
});
test("career decision validate normalizes a decision file", async () => {
  assert.equal(await runCli(["decision", "validate", path], createIo().io), 0);
});
```

- [ ] **Step 2: Run focused test and confirm missing storage/CLI failure.**
- [ ] **Step 3: Implement storage.** Require an existing job artifact directory supplied by the caller; Slice 4 will create `data/jobs/<id>`, while Slice 3 uses an explicit manual/test directory. Use temp-file-plus-rename; reject blank Markdown; reject directory escapes and never create or touch profile/source files.
- [ ] **Step 4: Add `career decision validate <decision.json> [--out path]`.** Reuse current serialization and only validate/format JSON.
- [ ] **Step 5: Write `skills/assess-job/SKILL.md`.** Read `analysis.json`, base profile, and raw source; preserve required/preferred/unknown modality; set `clarify` for an unresolved salary/location/arrangement/critical requirement; create CV Markdown only when recommendation is `create` and only from profile facts.
- [ ] **Step 6: Update README with the three decisions and manual workflow; run `pnpm test`, `pnpm build`, `pnpm audit`, and `git diff --check`; commit:** `feat: add job decision artifacts`.

### Task 3: Slice report

**Files:** Create `reports/slice-3-job-decision.md`.

- [ ] **Step 1: Record actual commits, status/evidence semantics, source-protection behavior, commands, tests/build/audit result, and known limit: Codex remains manual and no UI exists yet.**
- [ ] **Step 2: Run `rg -n "TODO|TBD" reports/slice-3-job-decision.md` and `git diff --check`; commit:** `docs: report job decision slice`.

# Slice 2 — Candidate Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a local, validated base candidate profile that Codex can read without changing it while tailoring a job-specific draft.

**Architecture:** A strict TypeScript parser owns the `CandidateProfile` contract. Storage owns `data/profile/candidate-profile.json` and optional `source.md`; the CLI validates JSON only. The later browser app will use this exact storage contract.

**Tech Stack:** TypeScript, Node.js standard library, `tsx`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-25-career-copilot-slices-2-4-design.md`

## Global Constraints

- Keep all data local. No database, authentication, remote storage, API key, or model call.
- The user owns `candidate-profile.json`; only user-facing save operations write it.
- Reuse the existing Job employment vocabulary and immutable parser style.
- Work only on local branch `slice-2-candidate-profile`; do not push.

---

## File structure

| Path | Responsibility |
|---|---|
| `src/profile/schema.ts` | Types and strict `parseCandidateProfile`. |
| `src/profile/storage.ts` | Atomic base-profile and source-Markdown persistence. |
| `src/cli.ts` | `career profile validate` dispatch. |
| `skills/analyze-profile/SKILL.md` | Manual Codex extraction instructions. |
| `tests/profile.test.ts` | Parser, storage, and CLI contracts. |
| `reports/slice-2-candidate-profile.md` | Verified handoff report. |

## Contract

```ts
export type CandidateProfile = {
  contact?: { name?: string; email?: string; phone?: string; location?: string; links?: string[] };
  headline?: string;
  summary?: string;
  experience: Array<{ company?: string; title: string; startDate?: string; endDate?: string; highlights: string[] }>;
  skills: string[];
  education: Array<{ school?: string; degree?: string; field?: string; graduationDate?: string }>;
  languages: Array<{ language: string; level?: string }>;
  certifications?: string[];
  preferences?: {
    employmentTypes?: Array<"full-time" | "part-time" | "contract" | "internship" | "temporary">;
    workArrangements?: Array<"onsite" | "hybrid" | "remote">;
    locations?: string[]; minimumSalary?: string; schedule?: string; notes?: string;
  };
};
export function parseCandidateProfile(value: unknown): CandidateProfile;
export async function readCandidateProfile(root: string): Promise<CandidateProfile | undefined>;
export async function saveCandidateProfile(root: string, profile: CandidateProfile): Promise<void>;
export async function saveProfileSource(root: string, source: string): Promise<void>;
```

### Task 1: Profile schema and parser

**Files:** Create `src/profile/schema.ts`, `tests/profile.test.ts`; modify `package.json`.

**Interfaces:** Consumes the existing employment enum values. Produces `CandidateProfile` and `parseCandidateProfile` for all later slices.

- [ ] **Step 1: Write failing parser tests.**

```ts
test("parses a candidate profile with job-search constraints", () => {
  const profile = parseCandidateProfile({
    headline: "Backend developer",
    experience: [{ title: "Intern", highlights: ["Built internal tooling"] }],
    skills: ["TypeScript"], education: [],
    languages: [{ language: "English", level: "B2" }],
    preferences: { workArrangements: ["hybrid"], minimumSalary: "20M VND/month" },
  });
  assert.equal(profile.preferences?.minimumSalary, "20M VND/month");
});
test("rejects empty skills, missing highlights, and unsupported arrangements", () => {
  assert.throws(() => parseCandidateProfile({ experience: [], skills: [""], education: [], languages: [] }), /skills/);
  assert.throws(() => parseCandidateProfile({ experience: [{ title: "Intern" }], skills: [], education: [], languages: [] }), /highlights/);
  assert.throws(() => parseCandidateProfile({ experience: [], skills: [], education: [], languages: [], preferences: { workArrangements: ["flexible"] } }), /workArrangements/);
});
```

- [ ] **Step 2: Run `pnpm exec tsx --test tests/profile.test.ts`; confirm it fails because the parser is missing.**
- [ ] **Step 3: Implement the smallest parser.** Require `experience`, `skills`, `education`, and `languages` arrays; trim accepted text; reject empty strings and invalid enums; always create fresh arrays/objects.
- [ ] **Step 4: Change test script to `tsx --test tests/*.test.ts`; run `pnpm test` and `pnpm build`.**
- [ ] **Step 5: Commit only schema/test/package files:** `feat: add candidate profile validation`.

### Task 2: Storage, CLI, and Codex skill

**Files:** Create `src/profile/storage.ts`, `skills/analyze-profile/SKILL.md`, `data/profile/.gitkeep`; modify `src/cli.ts`, `.gitignore`, `README.md`, `tests/profile.test.ts`.

**Interfaces:** Consumes `parseCandidateProfile`. Produces profile source/JSON below a caller-provided workspace root and `career profile validate <profile.json> [--out path]`.

- [ ] **Step 1: Add failing storage and CLI tests.**

```ts
test("stores validated profile and preserves imported Markdown", async () => {
  await saveProfileSource(root, "# My CV\nBuilt APIs");
  await saveCandidateProfile(root, fixture);
  assert.equal(await readFile(join(root, "data", "profile", "source.md"), "utf8"), "# My CV\nBuilt APIs\n");
  assert.deepEqual(await readCandidateProfile(root), fixture);
});
test("career profile validate writes normalized JSON", async () => {
  assert.equal(await runCli(["profile", "validate", input, "--out", output], createIo().io), 0);
});
```

- [ ] **Step 2: Run focused test and confirm missing exports/CLI group fail.**
- [ ] **Step 3: Implement atomic same-directory temp-file-plus-rename writes.** `readCandidateProfile` returns `undefined` only when JSON is absent; it surfaces invalid JSON and I/O failures. Reject blank source Markdown.
- [ ] **Step 4: Add profile CLI usage/dispatch.** It parses and validates only; it never analyses prose.
- [ ] **Step 5: Write the skill.** It may structure a user-provided `.txt`/`.md` into a profile only on explicit request; it must not produce a tailored CV or alter job files.
- [ ] **Step 6: Ignore `data/profile/*` except `.gitkeep`; document source, validation, privacy, and manual Codex steps in README.**
- [ ] **Step 7: Run `pnpm test`, `pnpm build`, and `pnpm audit`; commit:** `feat: store local candidate profiles`.

### Task 3: Slice report

**Files:** Create `reports/slice-2-candidate-profile.md`.

- [ ] **Step 1: Record actual commits, contract, paths, commands, test/build/audit evidence, and known limits: no browser UI and no tailoring.**
- [ ] **Step 2: Run `rg -n "TODO|TBD" reports/slice-2-candidate-profile.md` and `git diff --check`; commit:** `docs: report candidate profile slice`.

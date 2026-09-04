# M1 — Workspace resilience implementation plan

**Goal:** Prevent accidental artifact loss, contain corrupt records, and prove a minimal local backup/restore on synthetic data.
**Authorization:** User requested NEXT-01 after M0. Implement in this checkout preserving existing documentation changes; no commit, migration or real-data backup is included.
**Spec:** [M0 NEXT-01](../../specs/local-it-career-workstation/27-m0-baseline-and-delivery-inventory.md), [M1 roadmap](../../specs/local-it-career-workstation/19-roadmap-and-milestones.md).
**Architecture:** Shared Node filesystem functions; no new dependency or stored schema. Exact-byte SHA-256 hashes are optimistic concurrency tokens, not signatures or semantic JSON hashes. Per-artifact exclusive lock files coordinate CLI/server writes. Missing artifact token means create-only; replacement requires the hash of the version read.
**Tech stack:** Existing TypeScript, Node HTTP/fs/crypto, native browser, node:test via tsx.

## Constraints and decisions

- Existing data files remain readable; do not rewrite or migrate them.
- Preserve all M0 changes and private user data. Work directly in the current checkout because the accepted baseline is uncommitted here; do not create a stale worktree from HEAD.
- Default CLI output is create-only. Single-file `--expected-hash sha256:...` permits a deliberate compare-and-replace; no unconditional force flag. Batch refuses existing outputs individually and reports failures.
- Locks fail fast. Never automatically reclaim a lock after a timeout/PID heuristic. Document manual recovery after all writers stop. Temporary files are not valid artifacts.
- Read/hash one snapshot. Write validated bytes, sync, close, and atomically publish; clean only the temp/lock created by the operation. Reject linked/non-regular artifact paths and linked ancestors before reading/writing.
- HTTP metadata uses ETag/If-Match; persisted profile/note shapes stay the same. Missing precondition is 428; stale or busy artifact is 409. UI retains the draft and its original token on conflict.
- Summaries contain corrupt-job placeholders and a profile error rather than failing unrelated jobs. Raw bytes remain untouched; direct use of a corrupt record still fails.
- Basic backup is an offline copy + hash verification runbook, not a new archive framework/restore command. Restore only into a new empty directory; never overwrite a working workspace.
- No model/connector/network feature is added. Tests use disposable synthetic data only.

## Task 1 — Shared artifact writer and storage adoption

Files: `src/workspace/artifacts.ts`, `src/profile/storage.ts`, `src/decision/storage.ts`, `tests/artifacts.test.ts`, `tests/profile.test.ts`, `tests/decision.test.ts`.

Interfaces:

```ts
contentHash(content: string | Buffer): string;
readArtifact(path: string): Promise<{ content: string; hash: string } | undefined>;
writeArtifact(path: string, content: string, expectedHash?: string | null): Promise<string>;
assertSafePath(path: string): Promise<void>;
// ConflictError identifies expected-version mismatch or another active writer.
```

- [x] RED: create-only collision preserves bytes; two writers with the same hash cannot both succeed; held lock refuses another process; stale hash and unsafe paths fail without writes; injected/real I/O failure retains old bytes and cleans own resources.
- [x] Implement using Node fs/crypto only, migrate duplicated profile/decision writers; no schema version fields added.
- [x] GREEN: focused artifact/profile/decision tests, then source review.

## Task 2 — Workspace and CLI resilience

Files: `src/workspace/storage.ts`, `src/cli.ts`, `tests/workspace.test.ts`, `tests/job-input.test.ts`, `tests/m1.test.ts`.

- [x] RED: corrupt raw job plus healthy job yields both a diagnostic row and usable healthy detail; CLI single/batch output collisions never replace existing files.
- [x] Adopt shared writer for source/raw/note, expose note snapshot and conditional save. Preserve valid-source failure boundaries and safe IDs.
- [x] CLI `--expected-hash` is single-output only; malformed tokens fail before filesystem mutation; batch errors preserve partial success honestly.
- [x] GREEN: targeted regression and existing CLI/workspace tests.

## Task 3 — Consistent API snapshots and conflict-aware UI

Files: `src/web/server.ts`, `public/app.js`, `public/render.js`, `tests/m1.test.ts`, `tests/workspace.test.ts`, `tests/web-smoke.test.ts`.

- [x] RED: two editors share a profile/note token; first saves, second returns 409 and keeps the first bytes. Missing If-Match returns 428. Profile corruption does not break summary; editor is disabled with visible warning.
- [x] API returns exact snapshot hashes. `/api/summary` adds `profileHash`, `profileSourceHash`, optional `profileError`; note/profile GET and save expose quoted ETag (`"missing"` if absent).
- [x] Freeze client edit-base tokens across refresh; never silently retry conflict with a newer token. Keep draft text and explain reconcile/reopen.
- [x] GREEN: API and browser harness tests including refresh races. No change to valid JSON profile/note request bodies.

## Task 4 — Root, privacy warning and recovery documentation

Files: `src/workspace/privacy.ts`, `src/web/server.ts`, `tests/m1.test.ts`, `README.md`, `docs/specs/local-it-career-workstation/28-m1-backup-and-recovery.md`.

- [x] Allow explicit `CAREER_WORKSPACE_ROOT` for the launched dashboard; static assets remain in the application checkout.
- [x] Check Git ignore/tracked status before workspace writes and warn if privacy cannot be verified; do not change Git config/ignore or create a new Git repository automatically.
- [x] Document quiescent `data/` copy, recursive SHA-256 manifest comparison, new-root restore, corrupt-artifact recovery and orphan lock handling.
- [x] Test a synthetic workspace backup/restore with hash equality and successful profile/job reads. No real data operation.

## Verification and finish

- [x] Run full tests and TypeScript build using direct Node/tsx/tsc equivalents; measure core coverage and report actual results (see delivery report for the initial pnpm setup failure).
- [x] Review source/security changes independently, fix actionable findings and rerun affected tests.
- [x] Check diff/links and record observed results and limitations. No commit/push.

The writer coordinates cooperating app/CLI processes. It is not a sandbox against a malicious local process that can race filesystem replacement, and a per-file atomic write is not a multi-file transaction. Backup requires all writers/editors to be stopped.

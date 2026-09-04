# M1 — Workspace resilience

**Date:** 2026-09-04
**Scope:** NEXT-01 from the [M0 baseline](../docs/specs/local-it-career-workstation/27-m0-baseline-and-delivery-inventory.md). No migration, commit, push or private user-data operation.

## Changes

- Shared `src/workspace/artifacts.ts`: exact-byte SHA-256 read snapshot, create-only default, explicit compare-and-replace, filesystem lock across processes, temp sync/publish/cleanup, rejection of linked/non-regular artifact paths and unsafe Windows aliases.
- Profile/decision/workspace storage and CLI share the writer. CLI single-file replacement accepts `--expected-hash`; batch preserves collisions and reports a nonzero exit with partial results.
- Profile/note/source HTTP mutations require a current version. Reads expose ETag, missing token returns 428, stale/busy returns 409. Responses use the saved bytes' hash rather than a second read of possibly changed data.
- Browser pins the edit base across refresh, retains drafts after conflict and blocks editing a malformed profile as though it were empty.
- Corrupt raw jobs remain diagnostic rows; healthy jobs remain usable. No corrupt bytes are silently repaired or deleted.
- Git privacy warnings inspect ignore/tracking without editing configuration. `CAREER_WORKSPACE_ROOT` separates data root from application assets.
- [Recovery runbook](../docs/specs/local-it-career-workstation/28-m1-backup-and-recovery.md): stopped-writer local copy, SHA-256 comparison, restore to a new root and explicit orphan-lock handling. No backup engine or new dependency.

## Verification observed

- TDD: four new CLI/corruption/HTTP tests failed on the original implementation; browser regressions also failed before fixes. Shared writer/privacy cases were exercised independently before integration.
- Full suite: **130/130 passed**, zero skipped, on Node 24.19.0 using the installed `tsx` loader.
- Core coverage: **93.79% lines, 83.17% branches, 94.58% functions** in the final post-push run. Privacy measured 100% line coverage; artifact coverage is 99.07% because the portable missing-ancestor branch is environment-dependent.
- TypeScript build (`tsc`): passed.
- Real Chrome headless against a synthetic workspace: JD creation; note save/reload; two tabs with one stale save returning 409 and preserving entered text; profile save; raw/profile corruption diagnostics; healthy workflow remains available. All requests outside the loopback test server were blocked; none were attempted by the page.
- Executed the PowerShell runbook's copy/hash/new-root restore against synthetic data: matching relative paths and SHA-256 hashes. The automated backup fixture also reopened profile and job through existing parsers.
- Dependency repair used the existing frozen lockfile. Initial `pnpm test` did not run because the local dependency installation was incomplete; after repair tests/build were invoked directly with the bundled Node/tsx/tsc rather than claiming that failed command passed. No lockfile or dependency version change is included.

Reproduction after normal dependency setup:

```powershell
pnpm test
pnpm build
```

Coverage invocation used in this environment:

```powershell
$testFiles = Get-ChildItem -LiteralPath tests -Filter '*.test.ts' -File | ForEach-Object FullName
node --import tsx --test --experimental-test-coverage '--test-coverage-include=src/**' $testFiles
```

## Practical limits

- Existing artifact schemas are unchanged. M1 hashes describe exact bytes; persisted schema-version envelopes and immutable profile revisions remain M2 work.
- Locks coordinate cooperating application/CLI writers. Direct editor/agent filesystem writes can bypass them. Portable Node path checks are not a sandbox against a hostile local process racing directory replacement.
- Atomicity is per file, not a multi-file transaction. Interrupted job creation may leave a recoverable source-only row. Backup requires all writers stopped.
- No automatic stale-lock reclamation. A crash may leave a lock/temp requiring the runbook; newer valid bytes must be inspected before retrying.
- Git warnings are advisory and refreshed before write requests and summary reads. No guarantee is made about cloud-drive sync or deliberate file sharing outside this application.
- Browser E2E and backup drills used only temporary synthetic workspaces, not the user's career records. No live provider or portal was tested.

## Final review and completion

M1 is complete. The independent bounded review covered artifact writes, HTTP snapshots and browser conflict handling. Its stale Git-warning finding was reproduced and fixed; warnings now refresh before writes and summary reads. A broken source file now reports a separate warning while a valid profile remains editable. Both regressions failed before the fixes and passed in the final 130-test run; TypeScript build also passed. The final dependency-link repair used the frozen lockfile with install scripts disabled and made no dependency/configuration changes. M2 has not started.

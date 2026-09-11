# M3.3 implementation report

## Scope

Implemented the bounded M3 closeout on branch `feature/opportunity-review` (forked from local `main` and carrying the M3.1/M3.2 dependency commits).

- The existing job detail page now shows retained opportunity-group members, exact-content and same-URL advisory hints, and saved pair decisions.
- Candidate decisions use a native peer/relation form (`same`, `different`, `defer`, `clear`) with an exact preview and explicit confirmation.
- Confirmation is bound to both job IDs, the relation, the loaded opportunity pointer hash and the displayed component members. Stale or repaired state is read-only; the UI never retries with a fresh hash.
- Added end-to-end local-storage/API coverage for transitive grouping, correction, stale writes, legacy members, corrupt pointers and byte-for-byte source preservation.
- Fixed the M3.2 union-find bug that could miss transitive contradictions when UUID ordering put the larger root on the left.

## Verification

Fresh checks on this branch:

- `npm test` — passed, 203 tests passed, 0 failed (run with the approved external Windows environment after the sandbox-only `EPERM` failure).
- Explicit complete suite with `node --test --test-concurrency=1 --import tsx …` — passed, 203 tests passed, 0 failed.
- `node --test --test-concurrency=1 --experimental-test-coverage --import tsx …` — passed, 203 tests passed, 0 failed; all-files coverage: 96.10% lines, 87.92% branches, 96.56% functions.
- Changed runtime coverage: `public/app.js` 99.09% lines / 85.48% branches, `public/render.js` 100.00% / 86.70%, `src/job/opportunities.ts` 84.62% / 84.85%, `src/workspace/opportunities.ts` 99.12% / 89.04%.
- `npm run build` — passed.
- `pnpm audit --audit-level=high` — passed; no known vulnerabilities found.
- `git diff --check` — passed; only normal LF/CRLF warnings were reported.

## Acceptance and limitations

- `NEXT-03` bounded subset is covered by capture, duplicate-hint, opportunity-storage/API, UI-rendering and `m3-opportunity-flow` tests.
- Synthetic browser-controller coverage passed, including confirmation invalidation and duplicate-submit protection. A real browser automation harness is not available in this repository, so manual/browser E2E verification remains blocked and is not claimed as complete.
- Original `source.md`, `source.json` and `raw.json` bytes remain unchanged through every tested decision mutation. Legacy sources remain readable and visibly unverified.
- Corrupt or dangling opportunity state fails closed. Recovery must stop active writers first, back up the workspace, then restore the matching `data/opportunities/current.json` and revision file together; do not delete history or lock files while a writer is active.
- URL fetching, portal connectors, fuzzy/semantic deduplication, source-bound analysis, application submission and broad scout/retention automation remain deferred. Existing `analysis.json` is not made source-bound, and opportunity grouping never grants submission approval.

No push, merge or remote PR was performed.

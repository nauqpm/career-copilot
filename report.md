# M3.1 implementation report

## Scope

Implemented local job captures and advisory exact duplicate hints on branch `feature/job-captures`.

- New paste and CLI single-file `.txt`/`.md` intake preserve exact UTF-8 source bytes in `source.md`.
- `source.json` records candidate intake provenance, source kind, optional reference/filename, raw hash and normalisation version.
- `raw.json` remains compatible and carries an ID/manifest hash marker.
- Readers distinguish verified, legacy and invalid capture state; tampered or partially missing new captures fail closed while preserving artifacts.
- Exact content and conservative absolute HTTP(S) URL comparisons are read-only hints. Records are never automatically merged or deleted.
- Existing `job analyze`/`prepare` contracts remain unchanged; new `job import` does not fetch URLs.

## Verification

Fresh checks on this branch:

- `node --test --import tsx tests/job-capture.test.ts tests/job-duplicates.test.ts` — passed.
- `node --test --import tsx tests/workspace.test.ts tests/web-smoke.test.ts tests/job-capture.test.ts tests/job-duplicates.test.ts` — 70 tests passed.
- Full registered suite via `node --test --import tsx ...` — 177 tests passed, 0 failed.
- `npm run build` — passed after fixing the capture marker type guard.
- `npm test` — blocked in the sandbox by `EPERM: operation not permitted, lstat 'C:\\Users\\quanp'`; use the explicit `node --test --import tsx` command above for the verified result.

## Review notes and limitations

- The current UI displays capture health and duplicate hints; M3.2 will add candidate-reviewed persistent opportunity decisions.
- Existing legacy job source bytes are not backfilled or relabelled as verified provenance.
- Duplicate scanning is an O(number of job directories) read-time scan and skips corrupt candidates with an incomplete-scan warning.
- No URL fetch, fuzzy matching, connector, database, background worker or semantic source-bound analysis was added.
- The report records local verification only; no commit push, merge or remote PR was performed.

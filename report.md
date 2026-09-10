# M3.2 implementation report

## Scope

Implemented candidate-reviewed opportunity decisions on branch `feature/opportunity-decisions`; this branch includes the M3.1 dependency commit.

- Pair decisions `same`, `different`, `defer` and pair-only `clear` are validated and normalized deterministically.
- `same` relations form read-time connected components; singleton source records remain visible and source folders remain independent.
- Immutable complete revisions and a hash-checked `current.json` pointer preserve history and reject stale concurrent writers.
- Unknown endpoints, transitive contradictions, corrupt pointers and invalid source references fail closed with repair-safe errors.
- Loopback API exposes healthy state, groups and repair markers; it requires `If-Match` and explicit candidate confirmation.

## Verification

Fresh checks on this branch:

- `node --test --import tsx tests/opportunities.test.ts tests/opportunity-storage.test.ts tests/opportunity-api.test.ts` — passed.
- Full registered suite including M3.1 and M3.2 tests — 186 tests passed, 0 failed.
- `npm run build` — passed after fixing the capture marker type guard.
- `npm test` — blocked in the sandbox by `EPERM: operation not permitted, lstat 'C:\\Users\\quanp'`; use the explicit `node --test --import tsx` command above for the verified result.

## Review notes and limitations

- M3.3 will add the candidate review UI; this PR intentionally exposes the API without a new browser workflow.
- Existing legacy job source bytes are not backfilled or relabelled as verified provenance.
- Group keys are read-time view keys, not durable application/matching identities; arbitrary component splitting is not automated.
- No URL fetch, fuzzy matching, connector, database, background worker or semantic source-bound analysis was added.
- The report records local verification only; no commit push, merge or remote PR was performed.

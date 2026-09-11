# M3 review remediation tasks

Source: `reports/2026-09-11-m3-five-branch-review.md`.

Delivery branch: `feature/review-remediation`, starting at UX `3358cc6`.
Local main base: `fdb1571`. Existing five branches remain historical references.
Implementation workers use `gpt-5.6-luna`, reasoning `max`, as requested.

## Bounded tasks

- [x] Capture integrity: port the scoped Plan B delta (`35c2880`, `cf99d4f`, `409482a`, `389a7df`) into the existing M3 capture implementation. Own storage and capture/duplicate tests. Verify mismatched raw/manifest metadata and damaged candidates cannot produce trusted hints.
- [x] F4: add a failing junction regression, mark valid job-name symbolic links as an incomplete duplicate scan without following them, then rerun capture tests.
- [x] Graph/F1: verify the existing union correction and retain the deterministic four-node regression from graph repair. Exercise root ordering and transitive contradictions.
- [x] Readiness/F3: integrate C summary reuse, share source-health rules between markers and writes, and test a legacy singleton missing source.md alongside a healthy pair.
- [x] UX/F2/F5: retain existing stable-poll and stale-response protections; add delayed same-form save coverage and protect newer draft edits while a request is pending.
- [x] Delivery/F6: review the combined diff, run the registered full suite with coverage, build and dependency audit; update the branch report and A/B/C/D mapping with fresh evidence and limitations.
- [x] Commit the scoped implementation and reports locally using conventional commits. Do not stage pre-existing untracked plans or temporary review folders. Remote push is outside this request.

## Verification and compatibility

Use synthetic temporary workspaces only. Preserve raw source bytes and revisions, local-only storage, legacy readability and explicit candidate confirmation. Add no dependencies or future M4/M5 features. Each defect receives a focused regression; integration verification uses the test list from package.json with Node test concurrency one. Record actual failures and environmental limits rather than borrowing previous branch pass counts. A separate Luna reviewer checks correctness and security before commits.

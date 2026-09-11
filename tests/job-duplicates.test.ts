import assert from "node:assert/strict";
import test from "node:test";

import { findExactDuplicateHints } from "../src/job/duplicates.js";

test("finds exact content and same URL reasons without merging candidates", () => {
  const hash = "sha256:" + "1".repeat(64);
  assert.deepEqual(findExactDuplicateHints(
    { jobId: "job-a", sourceHash: hash, sourceReference: "https://jobs.example.test/role?id=1" },
    [
      { jobId: "job-c", sourceHash: hash, sourceReference: "https://jobs.example.test/role?id=2" },
      { jobId: "job-b", sourceHash: "sha256:" + "2".repeat(64), sourceReference: "https://jobs.example.test/role?id=1" },
      { jobId: "job-a", sourceHash: hash, sourceReference: "https://jobs.example.test/role?id=1" },
    ],
  ), [
    { jobId: "job-b", reasons: ["same-url"] },
    { jobId: "job-c", reasons: ["exact-content"] },
  ]);
});

test("does not compare labels, credential URLs, or tracking-stripped URLs", () => {
  const hash = "sha256:" + "1".repeat(64);
  assert.deepEqual(findExactDuplicateHints(
    { jobId: "job-a", sourceHash: hash, sourceReference: "LinkedIn" },
    [
      { jobId: "job-b", sourceHash: "sha256:" + "2".repeat(64), sourceReference: "LinkedIn" },
      { jobId: "job-c", sourceReference: "https://u:p@jobs.example.test/role" },
      { jobId: "job-d", sourceReference: "https://jobs.example.test/role?utm_source=x" },
    ],
  ), []);
});

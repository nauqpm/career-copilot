import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPastedJob, listWorkspaceJobs, readWorkspaceJob } from "../src/workspace/storage.js";

test("creates a local job from pasted text and preserves source Markdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-workspace-"));
  const job = await createPastedJob(root, {
    content: "# Backend developer\nBuild APIs",
    sourceReference: "LinkedIn",
  });

  assert.match(job.id, /^[a-z0-9-]+$/);
  assert.equal(await readFile(join(root, "data", "jobs", job.id, "source.md"), "utf8"), "# Backend developer\nBuild APIs\n");
});

test("lists an unanalyzed job without exposing raw JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-workspace-"));
  await createPastedJob(root, { content: "Role description" });

  const [job] = await listWorkspaceJobs(root);
  assert.equal(job?.hasAnalysis, false);
  assert.equal("raw" in (job ?? {}), false);
});

test("rejects traversal-like job IDs", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-workspace-"));

  await assert.rejects(readWorkspaceJob(root, "../profile"), /job id/);
});

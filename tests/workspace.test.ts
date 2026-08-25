import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPastedJob, listWorkspaceJobs, readWorkspaceJob } from "../src/workspace/storage.js";
import { createWorkspaceServer } from "../src/web/server.js";

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

test("accepts pasted JD through localhost", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-workspace-"));
  const app = await startTestServer(root);

  try {
    const response = await fetch(`${app.url}/api/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Role description", sourceReference: "Company site" }),
    });

    assert.equal(response.status, 201);
    assert.equal((await response.json() as { hasAnalysis: boolean }).hasAnalysis, false);
  } finally {
    await app.close();
  }
});

test("rejects empty pasted JD", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-workspace-"));
  const app = await startTestServer(root);

  try {
    const response = await postJson(app.url, "/api/jobs", { content: " " });
    assert.equal(response.status, 400);
  } finally {
    await app.close();
  }
});

async function startTestServer(root: string) {
  const server = createWorkspaceServer({ root, port: 0 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function postJson(url: string, path: string, body: unknown) {
  return fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

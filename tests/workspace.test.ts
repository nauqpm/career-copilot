import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createPastedJob,
  listWorkspaceJobs,
  readWorkspaceJob,
  readWorkspaceJobNote,
  saveWorkspaceJobNote,
} from "../src/workspace/storage.js";
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

test("lists artifact status and latest local update time", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-workspace-"));
  const job = await createPastedJob(root, { content: "Backend role" });
  const directory = join(root, "data", "jobs", job.id);
  const sourcePath = join(directory, "source.md");
  const rawPath = join(directory, "raw.json");
  const analysisPath = join(directory, "analysis.json");
  const cvDraftPath = join(directory, "cv-draft.md");
  const sourceTime = new Date("2026-01-01T09:00:00.000Z");
  const rawTime = new Date("2026-01-01T10:00:00.000Z");
  const analysisTime = new Date("2026-01-02T09:00:00.000Z");
  const cvDraftTime = new Date("2026-01-03T09:00:00.000Z");

  await writeFile(analysisPath, JSON.stringify({
    title: "Backend Engineer",
    company: "Acme",
    requirements: [],
    responsibilities: [],
    employment: {
      type: "full-time",
      workArrangement: "hybrid",
      locations: [{ raw: "Ho Chi Minh City" }],
    },
    compensation: { salaryStatus: "not-stated" },
  }));
  await writeFile(cvDraftPath, "Draft CV");
  await utimes(sourcePath, sourceTime, sourceTime);
  await utimes(rawPath, rawTime, rawTime);
  await utimes(analysisPath, analysisTime, analysisTime);
  await utimes(cvDraftPath, cvDraftTime, cvDraftTime);

  const [summary] = await listWorkspaceJobs(root);

  assert.deepEqual(summary?.artifactStatus, {
    source: true,
    analysis: true,
    decision: false,
    cvDraft: true,
  });
  assert.equal(summary?.updatedAt, "2026-01-03T09:00:00.000Z");
  assert.equal(summary?.cvDraftUpdatedAt, "2026-01-03T09:00:00.000Z");
  assert.equal(summary?.employmentType, "full-time");
  assert.equal(summary?.workArrangement, "hybrid");
  assert.equal(summary?.locationPreview, "Ho Chi Minh City");
});

test("stores and reads a non-empty note for an existing job", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-workspace-"));
  const job = await createPastedJob(root, { content: "Backend role" });

  await saveWorkspaceJobNote(root, job.id, "Ask about the on-call rotation.");

  assert.equal(await readWorkspaceJobNote(root, job.id), "Ask about the on-call rotation.");
});

test("keeps a valid job visible when derived JSON is malformed", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-workspace-"));
  const job = await createPastedJob(root, { content: "Backend role" });
  const directory = join(root, "data", "jobs", job.id);

  await writeFile(join(directory, "analysis.json"), "{}");
  await writeFile(join(directory, "decision.json"), "{}");

  const [summary] = await listWorkspaceJobs(root);

  assert.equal(summary?.id, job.id);
  assert.equal(summary?.hasAnalysis, false);
  assert.match(summary?.invalidDerivedData ?? "", /analysis\.json is invalid/);
  assert.match(summary?.invalidDerivedData ?? "", /decision\.json is invalid/);
  assert.deepEqual(summary?.artifactStatus, {
    source: true,
    analysis: true,
    decision: true,
    cvDraft: false,
  });
});

test("uses a saved note as the latest workspace update", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-workspace-"));
  const job = await createPastedJob(root, { content: "Backend role" });
  const directory = join(root, "data", "jobs", job.id);
  const earlier = new Date("2026-01-01T09:00:00.000Z");

  await utimes(join(directory, "source.md"), earlier, earlier);
  await utimes(join(directory, "raw.json"), earlier, earlier);
  const [before] = await listWorkspaceJobs(root);
  await saveWorkspaceJobNote(root, job.id, "Ask about the on-call rotation.");
  const [after] = await listWorkspaceJobs(root);

  assert.notEqual(after?.updatedAt, before?.updatedAt);
  assert.equal(after?.updatedAt, (await stat(join(directory, "notes.md"))).mtime.toISOString());
});

test("sorts jobs by local update time and job ID ties", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-workspace-"));
  const first = await createPastedJob(root, { content: "First role" });
  const second = await createPastedJob(root, { content: "Second role" });
  const latest = await createPastedJob(root, { content: "Latest role" });
  const tiedTime = new Date("2026-01-01T09:00:00.000Z");
  const latestTime = new Date("2026-01-02T09:00:00.000Z");

  await setJobArtifactTimes(root, first.id, tiedTime);
  await setJobArtifactTimes(root, second.id, tiedTime);
  await setJobArtifactTimes(root, latest.id, latestTime);

  const jobs = await listWorkspaceJobs(root);

  assert.deepEqual(jobs.map((job) => job.id), [latest.id, ...[first.id, second.id].sort()]);
});

test("rejects blank notes and cannot create a note for a missing job", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-workspace-"));
  const job = await createPastedJob(root, { content: "Backend role" });

  await assert.rejects(() => saveWorkspaceJobNote(root, job.id, "   "));
  await assert.rejects(() => saveWorkspaceJobNote(root, "does-not-exist", "text"));
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

test("returns null for an existing job without a saved note", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-workspace-"));
  const job = await createPastedJob(root, { content: "Backend role" });
  const app = await startTestServer(root);

  try {
    const response = await fetch(`${app.url}/api/jobs/${job.id}/note`);

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
    assert.deepEqual(await response.json(), { content: null });
  } finally {
    await app.close();
  }
});

test("saves and returns an existing job note through localhost", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-workspace-"));
  const job = await createPastedJob(root, { content: "Backend role" });
  const app = await startTestServer(root);
  const content = "Ask about the on-call rotation.";

  try {
    const saved = await putJson(app.url, `/api/jobs/${job.id}/note`, { content });
    assert.equal(saved.status, 200);
    assert.match(saved.headers.get("content-type") ?? "", /^application\/json/);
    assert.deepEqual(await saved.json(), { content });

    const read = await fetch(`${app.url}/api/jobs/${job.id}/note`);
    assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), { content });
  } finally {
    await app.close();
  }
});

test("rejects invalid local note requests without creating job artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-workspace-"));
  const job = await createPastedJob(root, { content: "Backend role" });
  const missingId = "job-does-not-exist";
  const app = await startTestServer(root);

  try {
    const invalidRequests = [
      putJson(app.url, `/api/jobs/${job.id}/note`, { content: "  " }),
      putJson(app.url, `/api/jobs/${job.id}/note`, { content: 42 }),
      fetch(`${app.url}/api/jobs/${job.id}/note`, {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ content: "A note" }),
      }),
    ];

    for (const response of await Promise.all(invalidRequests)) {
      assert.equal(response.status, 400);
      assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
      assert.deepEqual(await response.json(), { error: "The supplied local data is invalid." });
    }
    const missing = await putJson(app.url, `/api/jobs/${missingId}/note`, { content: "A note" });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "Not found" });
    await assert.rejects(() => stat(join(root, "data", "jobs", missingId)));
    await assert.rejects(() => stat(join(root, "data", "jobs", job.id, "notes.md")));
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

function putJson(url: string, path: string, body: unknown) {
  return fetch(`${url}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function setJobArtifactTimes(root: string, jobId: string, timestamp: Date): Promise<void> {
  const directory = join(root, "data", "jobs", jobId);
  await utimes(join(directory, "source.md"), timestamp, timestamp);
  await utimes(join(directory, "raw.json"), timestamp, timestamp);
}

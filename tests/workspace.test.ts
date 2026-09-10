import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
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
  assert.equal(await readFile(join(root, "data", "jobs", job.id, "source.md"), "utf8"), "# Backend developer\nBuild APIs");
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

test("a missing-job CV download returns JSON 404 and leaves the server usable", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-workspace-"));
  const app = await startTestServer(root);

  try {
    const missing = await fetch(`${app.url}/api/jobs/job-does-not-exist/cv-draft`, { signal: AbortSignal.timeout(1000) });
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get("content-type") ?? "", /^application\/json/);
    assert.deepEqual(await missing.json(), { error: "Not found" });

    const safe = await fetch(`${app.url}/api/jobs`);
    assert.equal(safe.status, 200);
    assert.deepEqual(await safe.json(), []);
  } finally {
    await app.close();
  }
});

test("a static-file read failure stays inside the JSON error boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-workspace-"));
  await mkdir(join(root, "public", "unreadable.css"), { recursive: true });
  const app = await startTestServer(root);

  try {
    const failed = await fetch(`${app.url}/unreadable.css`, { signal: AbortSignal.timeout(1000) });
    assert.equal(failed.status, 500);
    assert.match(failed.headers.get("content-type") ?? "", /^application\/json/);
    assert.deepEqual(await failed.json(), { error: "Unable to process the local request." });
    assert.equal((await fetch(`${app.url}/api/jobs`)).status, 200);
  } finally {
    await app.close();
  }
});

test("accepts local authorities and matching HTTP origins on the listening port", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-workspace-"));
  const app = await startTestServer(root);
  const port = new URL(app.url).port;

  try {
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`]) {
      const headers = { host, origin: `http://${host}` };
      const listed = await requestWithHeaders(app.url, "/api/jobs", headers);
      assert.equal(listed.status, 200);
      const saved = await requestWithHeaders(app.url, "/api/jobs", headers, "POST", { content: "Local role" });
      assert.equal(saved.status, 201);
      const job = JSON.parse(saved.body) as { id: string };
      const mutations = [
        { method: "PUT", path: `/api/jobs/${job.id}/note`, body: { content: "Local note" }, status: 200 },
        { method: "PUT", path: "/api/profile", body: { experience: [], skills: [], education: [], languages: [] }, status: 200 },
        { method: "POST", path: "/api/profile/source", body: { content: "Local CV source" }, status: 204 },
      ];
      for (const mutation of mutations) {
        const snapshot = await fetch(`${app.url}${mutation.path === "/api/profile/source" ? "/api/summary" : mutation.path}`);
        const token = mutation.path === "/api/profile/source" ? `"${((await snapshot.json()) as {profileSourceHash: string | null}).profileSourceHash ?? "missing"}"` : snapshot.headers.get("etag")!;
        const response = await requestWithHeaders(app.url, mutation.path, { ...headers, "if-match": token }, mutation.method, mutation.body);
        assert.equal(response.status, mutation.status, mutation.path);
      }
      assert.equal(await readWorkspaceJobNote(root, job.id), "Local note");
    }
  } finally {
    await app.close();
  }
});

test("rejects foreign or incorrect Host before serving local data or static files", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-workspace-"));
  await mkdir(join(root, "public"));
  await writeFile(join(root, "public", "app.js"), "Local application asset");
  const app = await startTestServer(root);
  const port = new URL(app.url).port;

  try {
    const invalidHosts = [`foreign.example:${port}`, `localhost.foreign.example:${port}`, `127.0.0.2:${port}`, "localhost:1", "127.0.0.1", ""];
    for (const host of invalidHosts) {
      for (const path of ["/api/jobs", "/app.js"]) {
        const response = await requestWithHeaders(app.url, path, { host });
        assert.equal(response.status, 403, `${host} ${path}`);
        assert.match(response.contentType ?? "", /^application\/json/);
        assert.deepEqual(JSON.parse(response.body), { error: "Only local workspace requests are allowed." });
      }
    }
    const rejected = await requestWithHeaders(app.url, "/api/jobs", { host: `foreign.example:${port}`, origin: `http://foreign.example:${port}` }, "POST", { content: "Untrusted role" });
    assert.equal(rejected.status, 403);
    assert.deepEqual(await listWorkspaceJobs(root), []);
    assert.equal((await fetch(`${app.url}/app.js`)).status, 200);
  } finally {
    await app.close();
  }
});

test("rejects foreign origins on every JSON mutation without changing local artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-workspace-"));
  const job = await createPastedJob(root, { content: "Existing role" });
  const app = await startTestServer(root);
  const host = new URL(app.url).host;
  const mutations = [
    { method: "POST", path: "/api/jobs", body: { content: "Untrusted role" } },
    { method: "PUT", path: `/api/jobs/${job.id}/note`, body: { content: "Untrusted note" } },
    { method: "PUT", path: "/api/profile", body: { experience: [], skills: [], education: [], languages: [] } },
    { method: "POST", path: "/api/profile/source", body: { content: "Untrusted source" } },
  ];

  try {
    for (const origin of ["http://foreign.example", "null", "", `https://${host}`, "http://127.0.0.1:1", app.url.replace("127.0.0.1", "localhost")]) {
      for (const mutation of mutations) {
        const response = await requestWithHeaders(app.url, mutation.path, { host, origin }, mutation.method, mutation.body);
        assert.equal(response.status, 403, `${origin} ${mutation.path}`);
        assert.deepEqual(JSON.parse(response.body), { error: "Only local workspace requests are allowed." });
      }
    }
    assert.deepEqual((await listWorkspaceJobs(root)).map((entry) => entry.id), [job.id]);
    assert.equal(await readWorkspaceJobNote(root, job.id), undefined);
    await assert.rejects(() => stat(join(root, "data", "profile")), { code: "ENOENT" });
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
    const missingRead = await fetch(`${app.url}/api/jobs/${missingId}/note`);
    assert.equal(missingRead.status, 404);
    assert.match(missingRead.headers.get("content-type") ?? "", /^application\/json/);
    assert.deepEqual(await missingRead.json(), { error: "Not found" });
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

function requestWithHeaders(url: string, path: string, headers: Record<string, string>, method = "GET", body?: unknown) {
  return new Promise<{ status: number | undefined; contentType: string | undefined; body: string }>((resolve, reject) => {
    const request = httpRequest(`${url}${path}`, { method, setHost: false, headers: { "content-type": "application/json", ...headers } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode, contentType: response.headers["content-type"], body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

function postJson(url: string, path: string, body: unknown) {
  return fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function putJson(url: string, path: string, body: unknown) {
  const current = await fetch(`${url}${path}`);
  return fetch(`${url}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json", "if-match": current.headers.get("etag") ?? '"missing"' },
    body: JSON.stringify(body),
  });
}

async function setJobArtifactTimes(root: string, jobId: string, timestamp: Date): Promise<void> {
  const directory = join(root, "data", "jobs", jobId);
  await utimes(join(directory, "source.md"), timestamp, timestamp);
  await utimes(join(directory, "raw.json"), timestamp, timestamp);
}

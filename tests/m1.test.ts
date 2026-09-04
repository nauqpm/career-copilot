import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { createWorkspaceServer } from "../src/web/server.js";
import { createPastedJob, listWorkspaceJobs, readWorkspaceJob } from "../src/workspace/storage.js";
import { readCandidateProfile } from "../src/profile/storage.js";

const profile = { experience: [], skills: ["Testing"], education: [], languages: [] };
const hash = (bytes: string | Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

test("CLI refuses single output overwrite and accepts only the exact expected hash", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m1-"));
  const out = join(root, "raw.json");
  await writeFile(out, "original");
  const io = capture();
  assert.equal(await runCli(["job", "analyze", "New role", "--text", "--out", out], io), 1);
  assert.equal(await readFile(out, "utf8"), "original");
  assert.equal(await runCli(["job", "analyze", "New role", "--text", "--out", out, "--expected-hash", hash("original")], io), 0);
  const saved = await readFile(out, "utf8");
  assert.equal(await runCli(["job", "analyze", "Stale role", "--text", "--out", out, "--expected-hash", hash("original")], io), 1);
  assert.equal(await readFile(out, "utf8"), saved);
});

test("CLI batch reports collisions without replacing existing output", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m1-"));
  const inputs = join(root, "inputs"); const out = join(root, "outputs");
  await mkdir(inputs); await mkdir(out);
  await writeFile(join(inputs, "a.txt"), "Role A"); await writeFile(join(inputs, "b.txt"), "Role B");
  await writeFile(join(out, "a.json"), "keep me");
  const io = capture();
  assert.equal(await runCli(["job", "analyze", inputs, "--out", out], io), 1);
  assert.equal(await readFile(join(out, "a.json"), "utf8"), "keep me");
  assert.equal(JSON.parse(await readFile(join(out, "b.json"), "utf8")).content, "Role B");
  assert.match(io.errors(), /1 succeeded/); assert.match(io.errors(), /1 failed/);
});

test("corrupt raw record and profile remain visible without breaking healthy jobs", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m1-"));
  const healthy = await createPastedJob(root, { content: "Healthy role" });
  const bad = join(root, "data", "jobs", "job-bad"); await mkdir(bad);
  await writeFile(join(bad, "raw.json"), "{broken");
  await mkdir(join(root, "data", "profile")); await writeFile(join(root, "data", "profile", "candidate-profile.json"), "{broken");
  const jobs = await listWorkspaceJobs(root);
  assert.equal(jobs.length, 2);
  assert.ok((jobs.find((job) => job.id === "job-bad") as any).invalidSourceData);
  assert.equal((await readWorkspaceJob(root, healthy.id)).raw.content, "Healthy role");
  const app = await serve(root);
  try {
    const response = await fetch(`${app.url}/api/summary`);
    assert.equal(response.status, 200);
    const summary = await response.json() as any;
    assert.equal(summary.jobs.length, 2); assert.ok(summary.profileError);
    assert.equal(await readFile(join(bad, "raw.json"), "utf8"), "{broken");
  } finally { await app.close(); }
});

test("a broken profile source does not block a valid profile summary or editor state", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m1-"));
  await mkdir(join(root, "data", "profile"), { recursive: true });
  await writeFile(join(root, "data", "profile", "candidate-profile.json"), JSON.stringify(profile));
  await mkdir(join(root, "data", "profile", "source.md"));
  const app = await serve(root);
  try {
    const response = await fetch(`${app.url}/api/summary`);
    assert.equal(response.status, 200);
    const summary = await response.json() as any;
    assert.deepEqual(summary.profile, profile);
    assert.equal(summary.profileError, undefined);
    assert.match(summary.profileHash, /^sha256:/);
    assert.equal(summary.profileSourceHash, null);
    assert.match(summary.profileSourceError, /tệp nguồn/);
  } finally { await app.close(); }
});

test("profile and note require a read version and reject stale editor saves", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m1-"));
  const job = await createPastedJob(root, { content: "Role" });
  const app = await serve(root);
  try {
    for (const [path, first, second] of [
      ["/api/profile", profile, { ...profile, skills: ["Different"] }],
      [`/api/jobs/${job.id}/note`, { content: "first" }, { content: "second" }],
    ] as const) {
      const get = await fetch(app.url + path);
      const original = get.headers.get("etag"); assert.equal(original, '"missing"');
      const put = (body: unknown, tag?: string) => fetch(app.url + path, { method: "PUT", headers: { "content-type": "application/json", ...(tag ? { "if-match": tag } : {}) }, body: JSON.stringify(body) });
      assert.equal((await put(first)).status, 428);
      const saved = await put(first, original!); assert.equal(saved.status, 200);
      const currentTag = saved.headers.get("etag"); assert.match(currentTag!, /^"sha256:/);
      assert.equal((await put(second, original!)).status, 409);
      const current = await fetch(app.url + path); assert.deepEqual(await current.json(), first);
      assert.equal(current.headers.get("etag"), currentTag);
    }
  } finally { await app.close(); }
});

test("synthetic stopped-workspace backup restores identical files and readable records", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m1-"));
  const live = join(root, "live"); const backup = join(root, "backup"); const restored = join(root, "restored");
  const job = await createPastedJob(live, { content: "Synthetic QA role" });
  await mkdir(join(live, "data", "profile"));
  await writeFile(join(live, "data", "profile", "candidate-profile.json"), JSON.stringify(profile));
  await cp(join(live, "data"), join(backup, "data"), { recursive: true, force: false, errorOnExist: true });
  await cp(join(backup, "data"), join(restored, "data"), { recursive: true, force: false, errorOnExist: true });
  const manifest = async (base: string) => {
    const result: Record<string, string> = {};
    async function walk(dir: string, prefix = "") {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const relative = prefix + entry.name;
        if (entry.isDirectory()) await walk(join(dir, entry.name), relative + "/");
        else result[relative] = hash(await readFile(join(dir, entry.name)));
      }
    }
    await walk(base); assert.ok(Object.keys(result).length); return result;
  };
  assert.deepEqual(await manifest(join(restored, "data")), await manifest(join(live, "data")));
  assert.equal((await readWorkspaceJob(restored, job.id)).raw.content, "Synthetic QA role");
  assert.deepEqual(await readCandidateProfile(restored), profile);
});

function capture() { let stderr = ""; return { writeStdout() {}, writeStderr(chunk: string) { stderr += chunk; }, async readStdin() { return ""; }, errors: () => stderr }; }
async function serve(root: string) {
  const server = createWorkspaceServer({ root });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No port");
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

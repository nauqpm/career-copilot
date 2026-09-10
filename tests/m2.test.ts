import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.js";
import { createWorkspaceServer } from "../src/web/server.js";
import { readProfileSnapshot } from "../src/profile/storage.js";

const profile = { experience: [], skills: ["TypeScript"], education: [], languages: [] };

test("profile publish requires confirmation and preserves the legacy artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m2-"));
  await mkdir(join(root, "data", "profile"), { recursive: true });
  const legacyPath = join(root, "data", "profile", "candidate-profile.json");
  await writeFile(legacyPath, `${JSON.stringify(profile, null, 2)}\n`);
  const app = await serve(root);
  try {
    const current = await fetch(`${app.url}/api/profile`);
    assert.equal(current.status, 200);
    const tag = current.headers.get("etag")!;
    const rejected = await fetch(`${app.url}/api/profile/publish`, { method: "POST", headers: { "content-type": "application/json", "if-match": tag }, body: JSON.stringify({ profile, confirmed: false }) });
    assert.equal(rejected.status, 428);
    assert.equal(await readFile(legacyPath, "utf8"), `${JSON.stringify(profile, null, 2)}\n`);
    const published = await fetch(`${app.url}/api/profile/publish`, { method: "POST", headers: { "content-type": "application/json", "if-match": tag }, body: JSON.stringify({ profile, confirmed: true }) });
    assert.equal(published.status, 201);
    assert.match(published.headers.get("etag")!, /^"sha256:[a-f0-9]{64}"$/);
    const history = await (await fetch(`${app.url}/api/profile/history`)).json() as any;
    assert.equal(history.revisions.length, 1);
    assert.equal(history.revisions[0].active, true);
  } finally { await app.close(); }
});

test("profile publish rejects a stale token without mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m2-"));
  const app = await serve(root);
  try {
    const first = await fetch(`${app.url}/api/profile/publish`, { method: "POST", headers: { "content-type": "application/json", "if-match": '"missing"' }, body: JSON.stringify({ profile, confirmed: true }) });
    assert.equal(first.status, 201);
    const stale = await fetch(`${app.url}/api/profile/publish`, { method: "POST", headers: { "content-type": "application/json", "if-match": '"missing"' }, body: JSON.stringify({ profile: { ...profile, skills: ["Go"] }, confirmed: true }) });
    assert.equal(stale.status, 409);
    assert.deepEqual(await (await fetch(`${app.url}/api/profile`)).json(), profile);
  } finally { await app.close(); }
});

test("profile API validates evidence before writing and exposes immutable revision ETags", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m2-"));
  const app = await serve(root);
  try {
    const missingToken = await fetch(`${app.url}/api/profile/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile, confirmed: true }) });
    assert.equal(missingToken.status, 428);
    const invalidEvidence = await fetch(`${app.url}/api/profile/publish`, { method: "POST", headers: { "content-type": "application/json", "if-match": '"missing"' }, body: JSON.stringify({ profile, confirmed: true, evidence: [{ verification: "unverified" }] }) });
    assert.equal(invalidEvidence.status, 400);
    assert.equal((await (await fetch(`${app.url}/api/profile/history`)).json() as any).revisions.length, 0);
    const created = await fetch(`${app.url}/api/profile/publish`, { method: "POST", headers: { "content-type": "application/json", "if-match": '"missing"' }, body: JSON.stringify({ profile, confirmed: true }) });
    const createdBody = await created.json() as any;
    const revisionId = createdBody.revision.id;
    const revision = await fetch(`${app.url}/api/profile/revisions/${revisionId}`);
    assert.equal(revision.status, 200);
    assert.equal(revision.headers.get("etag"), `"${created.headers.get("etag")!.slice(1, -1)}"`);
    const put = await fetch(`${app.url}/api/profile`, { method: "PUT", headers: { "content-type": "application/json", "if-match": created.headers.get("etag")! }, body: JSON.stringify({ ...profile, skills: ["Go"] }) });
    assert.equal(put.status, 200);
    assert.match(put.headers.get("etag")!, /^"sha256:/);
  } finally { await app.close(); }
});

test("summary keeps source and history readable when the active pointer is corrupt", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m2-"));
  await mkdir(join(root, "data", "profile"), { recursive: true });
  await writeFile(join(root, "data", "profile", "source.md"), "# Profile\n");
  await writeFile(join(root, "data", "profile", "current.json"), "{broken");
  const app = await serve(root);
  try {
    const summary = await (await fetch(`${app.url}/api/summary`)).json() as any;
    assert.ok(summary.profileError);
    assert.match(summary.profileSourceHash, /^sha256:/);
    assert.deepEqual(summary.profileHistory, { revisions: [] });
  } finally { await app.close(); }
});

test("invalid publish profile is a client error and leaves the active state unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m2-"));
  const app = await serve(root);
  try {
    const first = await fetch(`${app.url}/api/profile/publish`, { method: "POST", headers: { "content-type": "application/json", "if-match": '"missing"' }, body: JSON.stringify({ profile, confirmed: true }) });
    const tag = first.headers.get("etag")!;
    const invalid = await fetch(`${app.url}/api/profile/publish`, { method: "POST", headers: { "content-type": "application/json", "if-match": tag }, body: JSON.stringify({ profile: { skills: "not-an-array" }, confirmed: true }) });
    assert.equal(invalid.status, 400);
    const current = await fetch(`${app.url}/api/profile`);
    assert.equal(current.headers.get("etag"), tag);
    assert.deepEqual(await current.json(), profile);
    assert.equal((await (await fetch(`${app.url}/api/profile/history`)).json() as any).revisions.length, 1);
  } finally { await app.close(); }
});

test("stored profile corruption is a server recovery error on read-only GET", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m2-"));
  await mkdir(join(root, "data", "profile"), { recursive: true });
  await writeFile(join(root, "data", "profile", "candidate-profile.json"), "{broken");
  const app = await serve(root);
  try {
    const response = await fetch(`${app.url}/api/profile`);
    assert.equal(response.status, 500);
  } finally { await app.close(); }
});

test("CLI profile publish requires confirmation and accepts the current hash", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m2-"));
  const input = join(root, "profile.json");
  await writeFile(input, JSON.stringify(profile));
  const io = { writeStdout() {}, writeStderr() {}, async readStdin() { return ""; } };
  assert.equal(await runCli(["profile", "publish", input, "--root", root], io), 1);
  await mkdir(join(root, "data", "profile"), { recursive: true });
  const legacy = `${JSON.stringify(profile, null, 2)}\n`;
  await writeFile(join(root, "data", "profile", "candidate-profile.json"), legacy);
  const observed = (await readProfileSnapshot(root)).hash;
  assert.equal(await runCli(["profile", "publish", input, "--root", root, "--confirm"], io), 1);
  assert.equal(await runCli(["profile", "publish", input, "--root", root, "--confirm", "--expected-hash", observed!], io), 0);
});

async function serve(root: string) {
  const server = createWorkspaceServer({ root });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

test("missing evidence produces a recovery warning and rejects active and historical reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m2-"));
  const app = await serve(root);
  try {
    const response = await fetch(`${app.url}/api/profile/publish`, { method: "POST", headers: { "content-type": "application/json", "if-match": '"missing"' }, body: JSON.stringify({ profile, confirmed: true }) });
    assert.equal(response.status, 201);
    const { revision } = await response.json() as any;
    await unlink(join(root, "data", "profile", "evidence", `${revision.claimEvidence[0].evidenceIds[0]}.json`));
    assert.equal((await fetch(`${app.url}/api/profile`)).status, 500);
    assert.equal((await fetch(`${app.url}/api/profile/revisions/${revision.id}`)).status, 500);
    const summary = await (await fetch(`${app.url}/api/summary`)).json() as any;
    assert.ok(summary.profileError);
    assert.equal(summary.profileRevision, null);
    assert.deepEqual(summary.profileHistory.revisions, []);
  } finally { await app.close(); }
});

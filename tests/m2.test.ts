import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.js";
import { createWorkspaceServer } from "../src/web/server.js";

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

test("CLI profile publish requires confirmation and accepts the current hash", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-m2-"));
  const input = join(root, "profile.json");
  await writeFile(input, JSON.stringify(profile));
  const io = { writeStdout() {}, writeStderr() {}, async readStdin() { return ""; } };
  assert.equal(await runCli(["profile", "publish", input, "--root", root], io), 1);
  assert.equal(await runCli(["profile", "publish", input, "--root", root, "--confirm"], io), 0);
});

async function serve(root: string) {
  const server = createWorkspaceServer({ root });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

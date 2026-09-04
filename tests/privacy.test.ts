import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { artifactPrivacyWarnings, workspacePrivacyWarnings } from "../src/workspace/privacy.js";
import { createWorkspaceServer } from "../src/web/server.js";

const execute = promisify(execFile);
const ignore = ["raw", "analysis", "jobs", "profile"].map(name => `data/${name}/*\n!data/${name}/.gitkeep`).join("\n");

test("server refreshes privacy warnings after Git protection changes", async () => {
  const root = await repository();
  await writeFile(join(root, ".gitignore"), ignore);
  const server = createWorkspaceServer({ root });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const summary = async () => (await (await fetch(`http://127.0.0.1:${address.port}/api/summary`)).json()) as { privacyWarnings: string[] };
    assert.deepEqual((await summary()).privacyWarnings, []);
    await writeFile(join(root, ".gitignore"), "");
    assert.equal((await summary()).privacyWarnings.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "career-privacy-"));
  await execute("git", ["init", root]);
  return root;
}

test("outside Git is safe and missing workspace roots are never created", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-privacy-"));
  assert.deepEqual(await workspacePrivacyWarnings(join(root, "new-workspace")), []);
  assert.deepEqual(await readdir(root), []);
});

test("warns when Git does not ignore every private artifact directory", async () => {
  const root = await repository();
  assert.equal((await workspacePrivacyWarnings(root)).length, 1);
  await writeFile(join(root, ".gitignore"), "data/raw/*\n");
  assert.equal((await workspacePrivacyWarnings(root)).length, 1);
  await writeFile(join(root, ".gitignore"), ignore);
  assert.deepEqual(await workspacePrivacyWarnings(root), []);
});

test("tracked private files warn despite ignore rules; placeholders are allowed", async () => {
  const root = await repository();
  await writeFile(join(root, ".gitignore"), ignore);
  await mkdir(join(root, "data", "profile"), { recursive: true });
  await writeFile(join(root, "data", "profile", ".gitkeep"), "");
  await execute("git", ["-C", root, "add", "data/profile/.gitkeep"]);
  assert.deepEqual(await workspacePrivacyWarnings(root), []);
  await writeFile(join(root, "data", "profile", "secret-person.json"), "private");
  await execute("git", ["-C", root, "add", "-f", "data/profile/secret-person.json"]);
  const warnings = await workspacePrivacyWarnings(root);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /tracked/i);
  assert.doesNotMatch(warnings[0], /secret-person|private|career-privacy-/);
});

test("checks the containing repository for a missing nested workspace", async () => {
  const root = await repository();
  await writeFile(join(root, ".gitignore"), "future/data/\n");
  assert.deepEqual(await workspacePrivacyWarnings(join(root, "future")), []);
  assert.deepEqual((await readdir(root)).sort(), [".git", ".gitignore"]);
});

test("checks exact standalone outputs for ignore rules and existing tracking", async () => {
  const root = await repository();
  const output = join(root, "candidate.json");
  assert.match((await artifactPrivacyWarnings(output))[0], /not ignored/);
  await writeFile(join(root, ".gitignore"), "candidate.json\n");
  assert.deepEqual(await artifactPrivacyWarnings(output), []);
  await writeFile(output, "{}");
  await execute("git", ["-C", root, "add", "-f", "candidate.json"]);
  assert.match((await artifactPrivacyWarnings(output))[0], /tracked/);
  const outside = await mkdtemp(join(tmpdir(), "career-privacy-"));
  assert.deepEqual(await artifactPrivacyWarnings(join(outside, "output")), []);
});

test("unsafe or unreadable workspace verification warns without leaking paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "career-privacy-"));
  const file = join(root, "file");
  await writeFile(file, "x");
  assert.match((await workspacePrivacyWarnings(file))[0], /Could not verify/);
  assert.match((await artifactPrivacyWarnings("bad\0path"))[0], /Could not verify/);
});

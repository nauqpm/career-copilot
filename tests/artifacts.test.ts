import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertSafePath, ConflictError, contentHash, readArtifact, writeArtifact } from "../src/workspace/artifacts.js";

test("artifact hashes preserve exact bytes and missing reads are explicit", async () => {
  const root = await mkdtemp(join(tmpdir(), "artifact-"));
  assert.equal(await readArtifact(join(root, "missing")), undefined);
  assert.equal(contentHash("abc"), "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(contentHash("abc"), contentHash(Buffer.from("abc")));
  assert.notEqual(contentHash("abc"), contentHash("abc\n"));
});

test("creates once and requires an exact current hash for replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "artifact-"));
  const path = join(root, "nested", "document.md");
  const hash = await writeArtifact(path, "first");
  await assert.rejects(writeArtifact(path, "clobber"), ConflictError);
  await assert.rejects(writeArtifact(path, "stale", contentHash("older")), ConflictError);
  assert.equal(await readFile(path, "utf8"), "first");
  await writeArtifact(path, "second", hash);
  assert.deepEqual(await readArtifact(path), { content: "second", hash: contentHash("second") });
  assert.deepEqual(await readdir(join(root, "nested")), ["document.md"]);
});

test("an existing writer lock fails closed without removing its lock or changing data", async () => {
  const root = await mkdtemp(join(tmpdir(), "artifact-"));
  const path = join(root, "data.json");
  await writeFile(path, "original");
  await writeFile(`${path}.lock`, "other writer");
  await assert.rejects(writeArtifact(path, "changed", contentHash("original")), ConflictError);
  assert.equal(await readFile(path, "utf8"), "original");
  assert.equal(await readFile(`${path}.lock`, "utf8"), "other writer");
});

test("concurrent writers accept only one update from a shared original hash", async () => {
  const root = await mkdtemp(join(tmpdir(), "artifact-"));
  const path = join(root, "data.json");
  const hash = await writeArtifact(path, "original");
  const results = await Promise.allSettled([writeArtifact(path, "one", hash), writeArtifact(path, "two", hash)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected" && result.reason instanceof ConflictError).length, 1);
  assert.deepEqual(await readdir(root), ["data.json"]);
});

test("a filesystem lock held by a separate process prevents overwrite", async () => {
  const root = await mkdtemp(join(tmpdir(), "artifact-"));
  const path = join(root, "data.json");
  const hash = await writeArtifact(path, "original");
  const child = spawn(process.execPath, ["-e", `
    const fs = require('node:fs');
    const lock = process.argv[1];
    const fd = fs.openSync(lock, 'wx');
    process.stdout.write('ready');
    process.stdin.resume();
    process.stdin.on('end', () => { fs.closeSync(fd); fs.unlinkSync(lock); });
  `, `${path}.lock`], { stdio: ["pipe", "pipe", "pipe"] });
  try {
    await once(child.stdout, "data");
    await assert.rejects(writeArtifact(path, "changed", hash), ConflictError);
    assert.equal(await readFile(path, "utf8"), "original");
  } finally {
    const exited = once(child, "exit");
    child.stdin.end();
    await exited;
  }
  await writeArtifact(path, "updated", hash);
});

test("failed temporary writes preserve previous bytes and clean up owned files", async () => {
  const root = await mkdtemp(join(tmpdir(), "artifact-"));
  const path = join(root, "data.json");
  const hash = await writeArtifact(path, "original");
  await assert.rejects(writeArtifact(path, {} as unknown as string, hash), TypeError);
  assert.equal(await readFile(path, "utf8"), "original");
  assert.deepEqual(await readdir(root), ["data.json"]);
});

test("rejects directory artifacts and junction ancestors before following them", async () => {
  const root = await mkdtemp(join(tmpdir(), "artifact-"));
  const outside = await mkdtemp(join(tmpdir(), "artifact-outside-"));
  await mkdir(join(root, "directory"));
  await assert.rejects(readArtifact(join(root, "directory")), /regular file/);
  await symlink(outside, join(root, "linked"), "junction");
  await assert.rejects(writeArtifact(join(root, "linked", "new", "data.json"), "bad"), /link/i);
  await assert.rejects(readArtifact(join(root, "linked", "missing")), /link/i);
  assert.deepEqual(await readdir(outside), []);
});

test("rejects Windows aliases and streams before filesystem access", async () => {
  if (process.platform !== "win32") return;
  for (const path of ["C:\\temp\\NUL.json", "C:\\temp\\file:stream", "C:\\temp\\trailing.", "\\\\?\\C:\\temp\\file"]) {
    await assert.rejects(assertSafePath(path), /Unsafe/);
  }
});

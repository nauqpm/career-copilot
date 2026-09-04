import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { assertSafePath } from "./artifacts.js";

const execute = promisify(execFile);
const unknownProtection = "Could not verify Git protection for career data. Check repository tracking and ignore rules before adding data.";

export async function workspacePrivacyWarnings(root: string): Promise<string[]> {
  try {
    await assertSafePath(root);
    const repository = await containingRepository(root);
    if (!repository) return [];
    const dataPath = relative(repository, join(resolve(root), "data")).split("\\").join("/");
    const tracked = (await git(repository, ["ls-files", "-z", "--", dataPath])).split("\0").filter(Boolean);
    const warnings = tracked.some(path => basename(path) !== ".gitkeep")
      ? ["Career data is already tracked by Git. Ignore rules alone do not prevent tracked content from being committed."]
      : [];
    const probes = ["raw", "analysis", "jobs", "profile"].map(name => `${dataPath}/${name}/career-privacy-probe.json`);
    const ignored = await Promise.all(probes.map(path => isIgnored(repository, path)));
    return ignored.every(Boolean)
      ? warnings
      : [...warnings, "Git ignore rules do not cover all career data directories. Add protection before committing workspace changes."];
  } catch {
    return [unknownProtection];
  }
}

export async function artifactPrivacyWarnings(path: string): Promise<string[]> {
  try {
    await assertSafePath(path);
    const repository = await containingRepository(dirname(resolve(path)));
    if (!repository) return [];
    const artifact = relative(repository, resolve(path)).split("\\").join("/");
    const tracked = await git(repository, ["ls-files", "-z", "--", artifact]);
    if (tracked) return ["The output artifact is already tracked by Git. Its content may be included in future commits."];
    return await isIgnored(repository, artifact)
      ? []
      : ["The output artifact is not ignored by Git. Protect it before committing workspace changes."];
  } catch {
    return [unknownProtection];
  }
}

async function containingRepository(path: string): Promise<string | undefined> {
  const existing = await existingDirectory(resolve(path));
  try {
    return (await git(existing, ["rev-parse", "--show-toplevel"])).trim();
  } catch (error) {
    if (typeof error === "object" && error !== null && "stderr" in error && /not a git repository/i.test(String(error.stderr))) return undefined;
    throw error;
  }
}

async function isIgnored(repository: string, path: string): Promise<boolean> {
  try {
    await git(repository, ["check-ignore", "--no-index", "--quiet", "--", path]);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 1) return false;
    throw error;
  }
}

async function existingDirectory(path: string): Promise<string> {
  try {
    if (!(await lstat(path)).isDirectory()) throw new Error("Workspace is not a directory");
    return path;
  } catch (error) {
    if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return existingDirectory(parent);
  }
}

async function git(directory: string, args: string[]): Promise<string> {
  const literal = args[0] === "ls-files" ? ["--literal-pathspecs"] : [];
  const { stdout } = await execute("git", [...literal, "-C", directory, ...args], {
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout;
}

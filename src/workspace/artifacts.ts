import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, parse, resolve, sep } from "node:path";

export class ConflictError extends Error {
  constructor(message = "Artifact changed or another writer holds its lock. Reload before saving.") {
    super(message);
    this.name = "ConflictError";
  }
}

export function contentHash(content: string | Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export async function assertSafePath(path: string): Promise<void> {
  if (path.includes("\0")) throw new Error("Unsafe artifact path");
  const absolute = resolve(path);
  const root = parse(absolute).root;
  if (process.platform === "win32") {
    if (absolute.startsWith("\\\\") || path.startsWith("\\\\")) throw new Error("Unsafe device/network path");
    for (const part of absolute.slice(root.length).split(/[\\/]/)) {
      if (/[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)) {
        throw new Error("Unsafe Windows artifact path");
      }
    }
  }
  const parts = absolute.slice(root.length).split(sep).filter(Boolean);
  for (let index = 0; index <= parts.length; index += 1) {
    const current = resolve(root, ...parts.slice(0, index));
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error(`Artifact path contains a symbolic link: ${current}`);
      if (index < parts.length && !info.isDirectory()) throw new Error(`Artifact ancestor is not a directory: ${current}`);
    } catch (error) {
      if (isCode(error, "ENOENT")) return;
      throw error;
    }
  }
}

export async function readArtifact(path: string): Promise<{ content: string; hash: string } | undefined> {
  await assertSafePath(path);
  try {
    if (!(await lstat(path)).isFile()) throw new Error(`Artifact must be a regular file: ${path}`);
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if (!(await file.stat()).isFile()) throw new Error(`Artifact must be a regular file: ${path}`);
      const bytes = await file.readFile();
      return { content: bytes.toString("utf8"), hash: contentHash(bytes) };
    } finally {
      await file.close();
    }
  } catch (error) {
    if (isCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

export async function writeArtifact(path: string, content: string, expectedHash: string | null = null): Promise<string> {
  await assertSafePath(path);
  await mkdir(dirname(path), { recursive: true });
  await assertSafePath(path);
  const lockPath = `${path}.lock`;
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if (isCode(error, "EEXIST")) throw new ConflictError();
    throw error;
  }
  try {
    const previous = await readArtifact(path);
    if ((previous?.hash ?? null) !== expectedHash) throw new ConflictError();
    await commitContent(path, content, expectedHash === null);
    return contentHash(content);
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

async function commitContent(path: string, content: string, createOnly: boolean): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx");
  try {
    try {
      await file.writeFile(content, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await assertSafePath(path);
    if (createOnly) await link(temporary, path);
    else await rename(temporary, path);
  } catch (error) {
    if (isCode(error, "EEXIST")) throw new ConflictError();
    throw error;
  } finally {
    try { await unlink(temporary); } catch (error) { if (!isCode(error, "ENOENT")) throw error; }
  }
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

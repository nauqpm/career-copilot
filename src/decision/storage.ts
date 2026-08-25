import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

import { type JobDecision, parseJobDecision } from "./schema.js";

export async function saveJobDecision(directory: string, decision: JobDecision): Promise<void> {
  await ensureDirectory(directory);
  const target = resolve(directory, "decision.json");
  await writeAtomically(target, `${JSON.stringify(parseJobDecision(decision), null, 2)}\n`);
}

export async function saveCvDraft(directory: string, markdown: string): Promise<void> {
  if (!markdown.trim()) throw new Error("CV draft must not be empty");
  await ensureDirectory(directory);
  await writeAtomically(resolve(directory, "cv-draft.md"), markdown.endsWith("\n") ? markdown : `${markdown}\n`);
}

async function ensureDirectory(directory: string): Promise<void> {
  try {
    if ((await stat(directory)).isDirectory()) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  throw new Error(`Job artifact directory does not exist: ${resolve(directory)}`);
}

async function writeAtomically(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

import { lstat } from "node:fs/promises";
import { assertSafePath, writeArtifact } from "../workspace/artifacts.js";
import { resolve } from "node:path";

import { type JobDecision, parseJobDecision } from "./schema.js";

export async function saveJobDecision(directory: string, decision: JobDecision, expectedHash: string | null = null): Promise<void> {
  await ensureDirectory(directory);
  const target = resolve(directory, "decision.json");
  await writeArtifact(target, `${JSON.stringify(parseJobDecision(decision), null, 2)}\n`, expectedHash);
}

export async function saveCvDraft(directory: string, markdown: string, expectedHash: string | null = null): Promise<void> {
  if (!markdown.trim()) throw new Error("CV draft must not be empty");
  await ensureDirectory(directory);
  await writeArtifact(resolve(directory, "cv-draft.md"), markdown.endsWith("\n") ? markdown : `${markdown}\n`, expectedHash);
}

async function ensureDirectory(directory: string): Promise<void> {
  await assertSafePath(directory);
  try {
    if ((await lstat(directory)).isDirectory()) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  throw new Error(`Job artifact directory does not exist: ${resolve(directory)}`);
}

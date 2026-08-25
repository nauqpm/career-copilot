import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

import { type CandidateProfile, parseCandidateProfile } from "./schema.js";

export async function readCandidateProfile(root: string): Promise<CandidateProfile | undefined> {
  try {
    return parseCandidateProfile(JSON.parse(await readFile(candidateProfilePath(root), "utf8")) as unknown);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  }
}

export async function saveCandidateProfile(root: string, profile: CandidateProfile): Promise<void> {
  const validated = parseCandidateProfile(profile);
  await writeAtomically(candidateProfilePath(root), `${JSON.stringify(validated, null, 2)}\n`);
}

export async function saveProfileSource(root: string, source: string): Promise<void> {
  if (!source.trim()) throw new Error("Profile source must not be empty");
  await writeAtomically(profileSourcePath(root), source.endsWith("\n") ? source : `${source}\n`);
}

function candidateProfilePath(root: string): string {
  return join(profileDirectory(root), "candidate-profile.json");
}

function profileSourcePath(root: string): string {
  return join(profileDirectory(root), "source.md");
}

function profileDirectory(root: string): string {
  return resolve(root, "data", "profile");
}

async function writeAtomically(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

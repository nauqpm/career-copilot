import { readArtifact, writeArtifact } from "../workspace/artifacts.js";
import { join, resolve } from "node:path";

import { type CandidateProfile, parseCandidateProfile } from "./schema.js";

export async function readCandidateProfile(root: string): Promise<CandidateProfile | undefined> {
  const artifact = await readArtifact(candidateProfilePath(root));
  return artifact ? parseCandidateProfile(JSON.parse(artifact.content) as unknown) : undefined;
}

export async function saveCandidateProfile(root: string, profile: CandidateProfile, expectedHash: string | null = null): Promise<void> {
  const validated = parseCandidateProfile(profile);
  await writeArtifact(candidateProfilePath(root), `${JSON.stringify(validated, null, 2)}\n`, expectedHash);
}

export async function saveProfileSource(root: string, source: string, expectedHash: string | null = null): Promise<void> {
  if (!source.trim()) throw new Error("Profile source must not be empty");
  await writeArtifact(profileSourcePath(root), source.endsWith("\n") ? source : `${source}\n`, expectedHash);
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

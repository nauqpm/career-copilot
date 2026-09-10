export type PairDecision = {
  leftId: string;
  rightId: string;
  relation: "same" | "different" | "defer";
};

export type OpportunityRevision = {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  createdBy: { kind: "candidate" };
  previous: { id: string; hash: string } | null;
  decisions: PairDecision[];
};

export type OpportunityGroup = { key: string; jobIds: string[] };

export function parseOpportunityRevision(value: unknown): OpportunityRevision {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isSafeId(value.id) || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new Error("Opportunity revision is invalid");
  }
  if (!isRecord(value.createdBy) || value.createdBy.kind !== "candidate") throw new Error("Opportunity revision is invalid");
  const previous = value.previous;
  if (previous !== null && (!isRecord(previous) || !isSafeId(previous.id) || !/^sha256:[a-f0-9]{64}$/.test(String(previous.hash)))) throw new Error("Opportunity revision is invalid");
  if (!Array.isArray(value.decisions)) throw new Error("Opportunity revision is invalid");
  const decisions = value.decisions.map((decision) => parsePairDecision(decision));
  if (new Set(decisions.map(pairKey)).size !== decisions.length) throw new Error("Opportunity revision contains duplicate pairs");
  return {
    schemaVersion: 1,
    id: value.id,
    createdAt: new Date(value.createdAt).toISOString(),
    createdBy: { kind: "candidate" },
    previous: previous === null ? null : { id: previous.id, hash: previous.hash },
    decisions: decisions.sort(comparePairs),
  };
}

export function deriveOpportunityGroups(jobIds: string[], decisions: PairDecision[]): OpportunityGroup[] {
  const known = new Set(jobIds);
  if (known.size !== jobIds.length || [...known].some((id) => !isSafeId(id))) throw new Error("Opportunity job IDs are invalid");
  const normalized = decisions.map((decision) => normalizeDecision(decision));
  if (new Set(normalized.map(pairKey)).size !== normalized.length) throw new Error("Opportunity decisions contain duplicate pairs");
  for (const decision of normalized) {
    if (!known.has(decision.leftId) || !known.has(decision.rightId)) throw new Error("Opportunity decision references an unknown job");
  }
  const parent = new Map(jobIds.map((id) => [id, id]));
  const find = (id: string): string => {
    const value = parent.get(id);
    if (value === undefined) throw new Error("Opportunity decision references an unknown job");
    if (value === id) return id;
    const root = find(value);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot < rightRoot ? leftRoot : rightRoot);
  };
  for (const decision of normalized.filter((item) => item.relation === "same")) union(decision.leftId, decision.rightId);
  for (const decision of normalized.filter((item) => item.relation === "different")) {
    if (find(decision.leftId) === find(decision.rightId)) throw new Error("Opportunity decisions contain a transitive contradiction");
  }
  const groups = new Map<string, string[]>();
  for (const id of [...jobIds].sort()) {
    const root = find(id);
    const current = groups.get(root) ?? [];
    current.push(id);
    groups.set(root, current);
  }
  return [...groups.values()].map((jobIdsInGroup) => ({ key: jobIdsInGroup[0]!, jobIds: jobIdsInGroup })).sort((left, right) => left.key.localeCompare(right.key));
}

export function applyPairDecision(decisions: PairDecision[], input: PairDecision | { leftId: string; rightId: string; relation: "clear" }): PairDecision[] {
  const next = decisions.map(normalizeDecision);
  const normalized = normalizePair(input);
  const withoutPair = next.filter((decision) => pairKey(decision) !== pairKey(normalized));
  if (input.relation !== "clear") withoutPair.push({ ...normalized, relation: input.relation });
  return withoutPair.sort(comparePairs);
}

function parsePairDecision(value: unknown): PairDecision {
  if (!isRecord(value) || (value.relation !== "same" && value.relation !== "different" && value.relation !== "defer")) throw new Error("Opportunity pair decision is invalid");
  return normalizeDecision({ leftId: value.leftId, rightId: value.rightId, relation: value.relation });
}

function normalizeDecision(value: PairDecision): PairDecision {
  const pair = normalizePair(value);
  if (value.relation !== "same" && value.relation !== "different" && value.relation !== "defer") throw new Error("Opportunity pair decision is invalid");
  return { ...pair, relation: value.relation };
}

function normalizePair(value: { leftId: unknown; rightId: unknown; relation?: unknown }): { leftId: string; rightId: string } {
  if (!isSafeId(value.leftId) || !isSafeId(value.rightId) || value.leftId === value.rightId) throw new Error("Opportunity pair decision is invalid");
  return value.leftId < value.rightId ? { leftId: value.leftId, rightId: value.rightId } : { leftId: value.rightId, rightId: value.leftId };
}

function pairKey(value: { leftId: string; rightId: string }): string { return `${value.leftId}\0${value.rightId}`; }
function comparePairs(left: PairDecision, right: PairDecision): number { return left.leftId.localeCompare(right.leftId) || left.rightId.localeCompare(right.rightId); }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isSafeId(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9-]+$/.test(value); }

import { createHash } from "node:crypto";
import {
  loadGroundedPlaceKnowledge,
  type GroundedPlaceKnowledgeRecord,
} from "./store";

export type ClaimStatus = "supported" | "conditionally_supported" | "disputed" | "superseded" | "stale";
export type KnowledgeKindStatus = "supported" | "conditional" | "disputed" | "stale";
export type ComparisonDecision =
  | "equivalent_support"
  | "compatible_conditions"
  | "compatible_multiple"
  | "subjective_perspective"
  | "conflict"
  | "temporal_supersession";

export type ConflictAwareSupport = {
  evidenceId: string;
  sourceRecordId: string | null;
  sourceUrl: string | null;
  sourceType: string | null;
  factConfidence: number;
  groundingConfidence: number;
  groundingValidation: "validated" | "unsupported";
  groundingMethod: "exact_span" | "normalized_span" | "visual_evidence_record";
  hasEvidenceLocation: boolean;
  supportType: "direct" | "inferred";
  sourceSignal: string;
  evidenceText: string;
  sourceField: string;
  observedAt: string | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  provenance: Record<string, unknown> | null;
};

export type ConflictAwareClaim = {
  claimId: string;
  semanticIdentity: string;
  contextIdentity: string;
  kind: string;
  value: string;
  normalizedValue: string;
  qualifiers: Record<string, unknown>;
  normalizedQualifiers: Record<string, string>;
  status: ClaimStatus;
  supportCount: number;
  independentSourceCount: number;
  supportStrength: number;
  supports: ConflictAwareSupport[];
};

export type TruthMaintenanceAuditEntry = {
  decision: ComparisonDecision;
  factKind: string;
  claimIds: string[];
  evidenceIds: string[];
  semanticIdentities: string[];
  normalizedValues: string[];
  qualifiersCompared: Array<Record<string, string>>;
  qualifierOverlap: boolean;
  conflictDimension: string | null;
  confidence: number;
  preferredClaimId: string | null;
  reason: string;
  supportingSources: string[];
};

export type ConflictAwareKnowledgeKind = {
  kind: string;
  status: KnowledgeKindStatus;
  claims: ConflictAwareClaim[];
  preferredClaimId: string | null;
  preferenceReason: string | null;
};

export type ConflictAwarePlaceKnowledge = {
  canonicalPlaceId: string;
  generatedAt: string;
  knowledge: Record<string, ConflictAwareKnowledgeKind>;
  audit: TruthMaintenanceAuditEntry[];
};

const VOLATILE_KINDS = new Set(["pricing", "entry_fee"]);
const SUBJECTIVE_KINDS = new Set(["ambience", "creator_insight", "crowd_note"]);

function normalizedText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[-_/]+/g, " ")
    .replace(/[^a-z0-9₹\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTemporal(value: string) {
  return normalizedText(value)
    .replace(/\bweekend days?\b/g, "weekends")
    .replace(/\bweekend\b/g, "weekends")
    .replace(/\bweekdays?\b/g, "weekdays")
    .replace(/\bmornings?\b/g, "morning")
    .replace(/\bafternoons?\b/g, "afternoon")
    .replace(/\bevenings?\b/g, "evening")
    .replace(/\bnights?\b/g, "night")
    .trim();
}

function normalizeCurrency(value: string) {
  const normalized = normalizedText(value)
    .replace(/₹/g, "inr ")
    .replace(/\brs\.?\s*/g, "inr ")
    .replace(/\brupees?\b/g, "inr")
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const amount = /\b(?:inr\s*)?(\d+(?:\.\d+)?)\b/.exec(normalized)?.[1];
  return amount ? `inr ${Number(amount)}` : normalized;
}

export function normalizeClaimValue(kind: string, value: unknown) {
  const normalized = normalizedText(value).replace(/^(?:the|a|an)\s+/, "");
  if (kind === "pricing" || kind === "entry_fee") return normalizeCurrency(normalized);
  if (kind === "booking_required") {
    if (["true", "yes", "required", "mandatory"].includes(normalized)) return "true";
    if (["false", "no", "not required", "optional"].includes(normalized)) return "false";
  }
  if (kind === "crowd_note" && /crowd/.test(normalized)) return "crowded";
  if (kind === "parking") {
    if (["hard", "difficult", "challenging"].includes(normalized)) return "difficult";
    if (["not available", "unavailable", "none"].includes(normalized)) return "unavailable";
  }
  return normalized;
}

export function normalizeClaimQualifiers(input: Record<string, unknown> | null | undefined) {
  const aliases: Record<string, string> = {
    crowdedAt: "when",
    crowded_at: "when",
    time: "when",
    timeOfDay: "when",
    dayOfWeek: "when",
  };
  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input || {})) {
    const key = aliases[rawKey] || rawKey;
    if (rawValue === null || rawValue === undefined || rawValue === "") continue;
    const value = key === "when" ? normalizeTemporal(String(rawValue)) : normalizedText(rawValue);
    if (value) normalized[key] = value;
  }
  return Object.fromEntries(Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right)));
}

function stableJson(value: Record<string, string>) {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

function identityHash(input: string) {
  return createHash("sha256").update(input).digest("hex").slice(0, 20);
}

export function canonicalFactIdentity(input: {
  canonicalPlaceId: string;
  kind: string;
  value: unknown;
  qualifiers?: Record<string, unknown> | null;
}) {
  const normalizedValue = normalizeClaimValue(input.kind, input.value);
  const normalizedQualifiers = normalizeClaimQualifiers(input.qualifiers);
  const semanticIdentity = identityHash(JSON.stringify([
    input.canonicalPlaceId,
    input.kind,
    normalizedValue,
    stableJson(normalizedQualifiers),
  ]));
  const contextIdentity = identityHash(JSON.stringify([
    input.canonicalPlaceId,
    input.kind,
    stableJson(normalizedQualifiers),
  ]));
  return { normalizedValue, normalizedQualifiers, semanticIdentity, contextIdentity };
}

function sourceIdentity(support: ConflictAwareSupport) {
  return support.sourceUrl || `${support.sourceType || "unknown"}:${support.sourceRecordId || support.evidenceId}`;
}

function isFresh(support: ConflictAwareSupport, nowMs: number) {
  const expiresAt = Date.parse(String(support.expiresAt || ""));
  return !Number.isFinite(expiresAt) || expiresAt > nowMs;
}

function supportScore(support: ConflictAwareSupport, nowMs: number) {
  const direct = support.supportType === "direct" ? 1 : 0.55;
  const fresh = isFresh(support, nowMs) ? 1 : 0;
  return (
    support.factConfidence * 0.35 +
    support.groundingConfidence * 0.3 +
    direct * 0.2 +
    fresh * 0.15
  );
}

function parseConditionTokens(value: string) {
  const days = /weekends/.test(value) ? "weekends" : /weekdays/.test(value) ? "weekdays" : null;
  const time = ["morning", "afternoon", "evening", "night"].find((item) => value.includes(item)) || null;
  const clock = /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/.exec(value)?.[1].replace(/\s+/g, "") || null;
  return { days, time, clock };
}

function conditionValuesDisjoint(left: string, right: string) {
  if (left === right) return false;
  const a = parseConditionTokens(left);
  const b = parseConditionTokens(right);
  if (a.days && b.days && a.days !== b.days) return true;
  if (a.time && b.time && a.time !== b.time) return true;
  if (a.clock && b.clock && a.clock !== b.clock) return true;
  return false;
}

function qualifierOverlap(left: Record<string, string>, right: Record<string, string>) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const a = left[key];
    const b = right[key];
    if (!a || !b || a === b) continue;
    if (key === "when") {
      if (conditionValuesDisjoint(a, b)) return false;
      if (a.includes(b) || b.includes(a)) continue;
      return false;
    }
    return false;
  }
  return true;
}

function latestTimestamp(claim: ConflictAwareClaim, field: "observedAt" | "verifiedAt") {
  return Math.max(...claim.supports.map((support) => Date.parse(String(support[field] || ""))).filter(Number.isFinite), 0);
}

function allExpiredBefore(claim: ConflictAwareClaim, timestamp: number) {
  if (!timestamp) return false;
  return claim.supports.every((support) => {
    const expiresAt = Date.parse(String(support.expiresAt || ""));
    return Number.isFinite(expiresAt) && expiresAt <= timestamp;
  });
}

function temporalSupersession(left: ConflictAwareClaim, right: ConflictAwareClaim) {
  if (!VOLATILE_KINDS.has(left.kind) || left.contextIdentity !== right.contextIdentity) return null;
  const leftObserved = latestTimestamp(left, "observedAt");
  const rightObserved = latestTimestamp(right, "observedAt");
  if (leftObserved === rightObserved) return null;
  const older = leftObserved < rightObserved ? left : right;
  const newer = older === left ? right : left;
  const newerObserved = Math.max(leftObserved, rightObserved);
  return allExpiredBefore(older, newerObserved) ? { older, newer } : null;
}

function conflictDimension(kind: string, left: string, right: string) {
  if (kind === "booking_required") return left !== right ? "boolean_requirement" : null;
  if (kind === "exclusive_operator") return left !== right ? "exclusive_relationship_target" : null;
  if (kind === "pricing" || kind === "entry_fee") return left !== right ? "amount" : null;
  if (kind === "parking") {
    const opposites = new Set([`${left}:${right}`, `${right}:${left}`]);
    if (opposites.has("free:paid") || opposites.has("easy:difficult") || opposites.has("available:unavailable")) return "availability_or_cost";
  }
  return null;
}

function setClaimStatus(claim: ConflictAwareClaim, status: ClaimStatus) {
  const priority: Record<ClaimStatus, number> = { supported: 0, conditionally_supported: 1, stale: 2, superseded: 3, disputed: 4 };
  if (priority[status] > priority[claim.status]) claim.status = status;
}

function supportingSources(claims: ConflictAwareClaim[]) {
  return [...new Set(claims.flatMap((claim) => claim.supports.map(sourceIdentity)))];
}

export function buildConflictAwarePlaceKnowledge(input: {
  canonicalPlaceId: string;
  facts: GroundedPlaceKnowledgeRecord[];
  now?: Date;
}): ConflictAwarePlaceKnowledge {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const grouped = new Map<string, ConflictAwareClaim>();

  for (const fact of input.facts) {
    if (fact.grounding.validation.status !== "validated") continue;
    const identity = canonicalFactIdentity({
      canonicalPlaceId: input.canonicalPlaceId,
      kind: fact.kind,
      value: fact.value,
      qualifiers: fact.qualifiers,
    });
    const support: ConflictAwareSupport = {
      evidenceId: fact.evidenceId,
      sourceRecordId: fact.sourceRecordId,
      sourceUrl: fact.sourceUrl,
      sourceType: fact.sourceType,
      factConfidence: fact.factConfidence,
      groundingConfidence: fact.grounding.groundingConfidence,
      groundingValidation: fact.grounding.validation.status,
      groundingMethod: fact.grounding.validation.method,
      hasEvidenceLocation: Boolean(
        fact.grounding.span?.end > fact.grounding.span?.start ||
        fact.grounding.sourceLocation ||
        fact.grounding.frameReferences?.length,
      ),
      supportType: fact.grounding.supportType,
      sourceSignal: fact.grounding.sourceSignal,
      evidenceText: fact.grounding.evidenceText,
      sourceField: fact.grounding.sourceField,
      observedAt: fact.observedAt,
      verifiedAt: fact.verifiedAt,
      expiresAt: fact.expiresAt,
      provenance: fact.provenance,
    };
    const existing = grouped.get(identity.semanticIdentity);
    if (existing) {
      existing.supports.push(support);
      continue;
    }
    grouped.set(identity.semanticIdentity, {
      claimId: `claim_${identity.semanticIdentity}`,
      semanticIdentity: identity.semanticIdentity,
      contextIdentity: identity.contextIdentity,
      kind: fact.kind,
      value: fact.value,
      normalizedValue: identity.normalizedValue,
      qualifiers: fact.qualifiers,
      normalizedQualifiers: identity.normalizedQualifiers,
      status: "supported",
      supportCount: 0,
      independentSourceCount: 0,
      supportStrength: 0,
      supports: [support],
    });
  }

  const claims = [...grouped.values()];
  for (const claim of claims) {
    claim.supportCount = claim.supports.length;
    claim.independentSourceCount = new Set(claim.supports.map(sourceIdentity)).size;
    const scores = claim.supports.map((support) => supportScore(support, nowMs));
    claim.supportStrength = Number(Math.min(1, Math.max(...scores, 0) + Math.min(0.12, (claim.independentSourceCount - 1) * 0.04)).toFixed(4));
    if (!claim.supports.some((support) => isFresh(support, nowMs))) claim.status = "stale";
  }

  const audit: TruthMaintenanceAuditEntry[] = [];
  const knowledge: Record<string, ConflictAwareKnowledgeKind> = {};
  const byKind = new Map<string, ConflictAwareClaim[]>();
  for (const claim of claims) byKind.set(claim.kind, [...(byKind.get(claim.kind) || []), claim]);

  for (const [kind, kindClaims] of byKind) {
    for (const claim of kindClaims.filter((item) => item.supportCount > 1)) {
      audit.push({
        decision: "equivalent_support",
        factKind: kind,
        claimIds: [claim.claimId],
        evidenceIds: claim.supports.map((support) => support.evidenceId),
        semanticIdentities: [claim.semanticIdentity],
        normalizedValues: [claim.normalizedValue],
        qualifiersCompared: [claim.normalizedQualifiers],
        qualifierOverlap: true,
        conflictDimension: null,
        confidence: 1,
        preferredClaimId: claim.claimId,
        reason: "deterministic_normalization_grouped_equivalent_claims",
        supportingSources: supportingSources([claim]),
      });
    }

    let temporalPreferred: ConflictAwareClaim | null = null;
    for (let leftIndex = 0; leftIndex < kindClaims.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < kindClaims.length; rightIndex += 1) {
        const left = kindClaims[leftIndex];
        const right = kindClaims[rightIndex];
        const overlap = qualifierOverlap(left.normalizedQualifiers, right.normalizedQualifiers);
        const temporal = temporalSupersession(left, right);
        let decision: ComparisonDecision;
        let reason: string;
        let dimension: string | null = null;
        let preferredClaimId: string | null = null;

        if (!overlap) {
          decision = "compatible_conditions";
          reason = "qualifiers_describe_non_overlapping_or_distinct_contexts";
          setClaimStatus(left, "conditionally_supported");
          setClaimStatus(right, "conditionally_supported");
        } else if (temporal) {
          decision = "temporal_supersession";
          reason = "older_claim_expired_before_newer_claim_was_observed";
          setClaimStatus(temporal.older, "superseded");
          preferredClaimId = temporal.newer.claimId;
          temporalPreferred = temporal.newer;
        } else if (SUBJECTIVE_KINDS.has(kind)) {
          decision = "subjective_perspective";
          reason = "subjective_experiential_values_are_retained_as_multiple_perspectives";
          setClaimStatus(left, "conditionally_supported");
          setClaimStatus(right, "conditionally_supported");
        } else {
          dimension = conflictDimension(kind, left.normalizedValue, right.normalizedValue);
          if (dimension) {
            decision = "conflict";
            reason = "incompatible_values_apply_to_materially_the_same_context";
            setClaimStatus(left, "disputed");
            setClaimStatus(right, "disputed");
          } else {
            decision = "compatible_multiple";
            reason = "kind_allows_multiple_simultaneously_supported_values";
          }
        }

        audit.push({
          decision,
          factKind: kind,
          claimIds: [left.claimId, right.claimId],
          evidenceIds: [...left.supports, ...right.supports].map((support) => support.evidenceId),
          semanticIdentities: [left.semanticIdentity, right.semanticIdentity],
          normalizedValues: [left.normalizedValue, right.normalizedValue],
          qualifiersCompared: [left.normalizedQualifiers, right.normalizedQualifiers],
          qualifierOverlap: overlap,
          conflictDimension: dimension,
          confidence: decision === "subjective_perspective" ? 0.85 : 1,
          preferredClaimId,
          reason,
          supportingSources: supportingSources([left, right]),
        });
      }
    }

    const currentClaims = kindClaims.filter((claim) => claim.status !== "superseded" && claim.status !== "stale");
    const disputed = kindClaims.some((claim) => claim.status === "disputed");
    const conditional = kindClaims.some((claim) => claim.status === "conditionally_supported");
    const status: KnowledgeKindStatus = disputed
      ? "disputed"
      : conditional
        ? "conditional"
        : currentClaims.length
          ? "supported"
          : "stale";
    let preferredClaimId: string | null = temporalPreferred?.claimId || null;
    let preferenceReason: string | null = temporalPreferred ? "newer_fact_supersedes_expired_historical_fact" : null;
    if (!preferredClaimId && currentClaims.length === 1) {
      preferredClaimId = currentClaims[0].claimId;
      preferenceReason = currentClaims[0].supportCount > 1
        ? "single_semantic_claim_with_independent_agreement"
        : "single_supported_current_claim";
    }
    if (!preferredClaimId && disputed) {
      const ranked = [...currentClaims].sort((left, right) => right.supportStrength - left.supportStrength);
      if (ranked[0] && ranked[1] && ranked[0].supportStrength - ranked[1].supportStrength >= 0.2) {
        preferredClaimId = ranked[0].claimId;
        preferenceReason = "quality_policy_margin_prefers_claim_without_resolving_dispute";
      }
    }
    knowledge[kind] = { kind, status, claims: kindClaims, preferredClaimId, preferenceReason };
  }

  return { canonicalPlaceId: input.canonicalPlaceId, generatedAt: now.toISOString(), knowledge, audit };
}

export async function loadConflictAwarePlaceKnowledge(
  database: Parameters<typeof loadGroundedPlaceKnowledge>[0],
  canonicalPlaceId: string,
  options: { now?: Date } = {},
) {
  const facts = await loadGroundedPlaceKnowledge(database, canonicalPlaceId);
  return buildConflictAwarePlaceKnowledge({ canonicalPlaceId, facts, now: options.now });
}

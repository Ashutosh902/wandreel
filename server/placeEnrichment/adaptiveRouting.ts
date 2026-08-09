export const CORE_STRUCTURED_KNOWLEDGE_KINDS = [
  "best_time",
  "recommended_item",
  "crowd_note",
  "seating_tip",
  "pricing",
  "parking",
  "ambience",
] as const;

export type CoreStructuredKnowledgeKind = (typeof CORE_STRUCTURED_KNOWLEDGE_KINDS)[number];
export type KnowledgeCoverageStatus = "missing" | "weak" | "sufficient" | "stale" | "conflicting";
export type EnrichmentAction = "caption" | "transcript" | "ocr" | "visual" | "comments" | "web_signals";

export type KnowledgeEvidenceInput = {
  kind: string;
  value: string;
  confidence: number;
  sourceType: string | null;
  sourceUrl: string | null;
  observedAt: string | null;
  verifiedAt: string | null;
  expiresAt: string | null;
};

export type KnowledgeCoverageEntry = {
  status: KnowledgeCoverageStatus;
  factCount: number;
  freshFactCount: number;
  maxConfidence: number;
  supportingSourceCount: number;
  values: string[];
  reason: string;
};

export type KnowledgeCoverageAssessment = Record<string, KnowledgeCoverageEntry>;

export type EnrichmentActionCapability = {
  action: EnrichmentAction;
  cost: number;
  improves: readonly string[];
};

export type AdaptiveRoutingDecision = {
  initialCoverage: KnowledgeCoverageAssessment;
  gaps: string[];
  actionsConsidered: Array<{
    action: EnrichmentAction;
    cost: number;
    relevantGaps: string[];
    selected: boolean;
    reason: string;
  }>;
  selectedActions: EnrichmentAction[];
  skippedActions: EnrichmentAction[];
  stopReason: string | null;
  broadExploration: boolean;
  estimatedModelCallsAvoided: number;
  estimatedStagesAvoided: number;
};

export const ENRICHMENT_ACTION_CAPABILITIES: readonly EnrichmentActionCapability[] = [
  {
    action: "caption",
    cost: 1,
    improves: CORE_STRUCTURED_KNOWLEDGE_KINDS,
  },
  {
    action: "transcript",
    cost: 2,
    improves: ["best_time", "recommended_item", "crowd_note", "seating_tip", "pricing", "parking"],
  },
  {
    action: "ocr",
    cost: 3,
    improves: ["best_time", "recommended_item", "pricing", "parking"],
  },
  {
    action: "visual",
    cost: 4,
    improves: ["ambience", "seating_tip", "parking", "accessibility"],
  },
  {
    action: "comments",
    cost: 2,
    improves: ["recommended_item", "crowd_note", "seating_tip", "pricing", "ambience"],
  },
  {
    action: "web_signals",
    cost: 2,
    improves: ["best_time", "pricing", "parking", "accessibility"],
  },
] as const;

const CONFLICT_SENSITIVE_KINDS = new Set(["best_time", "pricing", "parking"]);
const SUFFICIENT_CONFIDENCE = 0.7;
const WEAK_CONFIDENCE = 0.45;

function normalizeValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function sourceIdentity(evidence: KnowledgeEvidenceInput) {
  return `${evidence.sourceType || "unknown"}:${evidence.sourceUrl || "unknown"}`;
}

function isFresh(evidence: KnowledgeEvidenceInput, nowMs: number) {
  if (!evidence.expiresAt) return true;
  const expiresAt = Date.parse(evidence.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt > nowMs;
}

export function assessKnowledgeCoverage(
  evidence: readonly KnowledgeEvidenceInput[],
  options: { now?: Date; kinds?: readonly string[] } = {},
): KnowledgeCoverageAssessment {
  const nowMs = (options.now ?? new Date()).getTime();
  const discoveredKinds = evidence.map((item) => item.kind).filter(Boolean);
  const kinds = [...new Set([...(options.kinds ?? CORE_STRUCTURED_KNOWLEDGE_KINDS), ...discoveredKinds])];
  const assessment: KnowledgeCoverageAssessment = {};

  for (const kind of kinds) {
    const facts = evidence.filter((item) => item.kind === kind && normalizeValue(item.value));
    if (!facts.length) {
      assessment[kind] = {
        status: "missing",
        factCount: 0,
        freshFactCount: 0,
        maxConfidence: 0,
        supportingSourceCount: 0,
        values: [],
        reason: "no_structured_evidence",
      };
      continue;
    }

    const freshFacts = facts.filter((item) => isFresh(item, nowMs));
    const bestFacts = freshFacts.filter((item) => item.confidence >= SUFFICIENT_CONFIDENCE);
    const values = [...new Set(facts.map((item) => normalizeValue(item.value)))];
    const freshStrongValues = [...new Set(bestFacts.map((item) => normalizeValue(item.value)))];
    const sources = new Set(freshFacts.map(sourceIdentity));
    const maxConfidence = Math.max(...facts.map((item) => item.confidence), 0);

    let status: KnowledgeCoverageStatus;
    let reason: string;
    if (!freshFacts.length) {
      status = "stale";
      reason = "all_evidence_expired";
    } else if (CONFLICT_SENSITIVE_KINDS.has(kind) && freshStrongValues.length > 1) {
      status = "conflicting";
      reason = "multiple_strong_values";
    } else if (bestFacts.length > 0) {
      status = "sufficient";
      reason = sources.size > 1 ? "strong_diverse_support" : "strong_fresh_support";
    } else {
      status = "weak";
      reason = maxConfidence >= WEAK_CONFIDENCE ? "confidence_below_threshold" : "low_confidence_only";
    }

    assessment[kind] = {
      status,
      factCount: facts.length,
      freshFactCount: freshFacts.length,
      maxConfidence,
      supportingSourceCount: sources.size,
      values,
      reason,
    };
  }

  return assessment;
}

function needsImprovement(entry: KnowledgeCoverageEntry) {
  return entry.status !== "sufficient";
}

export function planAdaptiveEnrichment(input: {
  coverage: KnowledgeCoverageAssessment;
  availableActions?: readonly EnrichmentAction[];
  maxCost?: number;
}): AdaptiveRoutingDecision {
  const available = new Set(input.availableActions ?? ENRICHMENT_ACTION_CAPABILITIES.map((item) => item.action));
  const maxCost = Math.max(0, input.maxCost ?? 8);
  const gaps = Object.entries(input.coverage)
    .filter(([, entry]) => needsImprovement(entry))
    .map(([kind]) => kind);
  const supportedFactCount = Object.values(input.coverage).filter((entry) => entry.factCount > 0).length;
  const broadExploration = supportedFactCount === 0 && gaps.length > 0;

  if (!gaps.length) {
    const actionsConsidered = ENRICHMENT_ACTION_CAPABILITIES.map((capability) => ({
      action: capability.action,
      cost: capability.cost,
      relevantGaps: [],
      selected: false,
      reason: available.has(capability.action) ? "coverage_already_sufficient" : "source_action_unavailable",
    }));
    return {
      initialCoverage: input.coverage,
      gaps,
      actionsConsidered,
      selectedActions: [],
      skippedActions: actionsConsidered.map((item) => item.action),
      stopReason: "relevant_knowledge_coverage_sufficient",
      broadExploration: false,
      estimatedModelCallsAvoided: 3,
      estimatedStagesAvoided: actionsConsidered.length,
    };
  }

  const selected = new Set<EnrichmentAction>();
  if (broadExploration) {
    for (const action of ["caption", "transcript", "ocr", "visual"] as const) {
      if (available.has(action)) selected.add(action);
    }
  } else {
    let cost = 0;
    const uncovered = new Set(gaps);
    for (const capability of [...ENRICHMENT_ACTION_CAPABILITIES].sort((a, b) => a.cost - b.cost)) {
      if (!available.has(capability.action)) continue;
      const relevant = capability.improves.filter((kind) => uncovered.has(kind));
      if (!relevant.length || cost + capability.cost > maxCost) continue;
      selected.add(capability.action);
      cost += capability.cost;
      for (const kind of relevant) uncovered.delete(kind);
      if (!uncovered.size) break;
    }
  }

  const actionsConsidered = ENRICHMENT_ACTION_CAPABILITIES.map((capability) => {
    const relevantGaps = capability.improves.filter((kind) => gaps.includes(kind));
    const isSelected = selected.has(capability.action);
    let reason = "higher_cost_or_redundant_capability";
    if (!available.has(capability.action)) reason = "source_action_unavailable";
    else if (!relevantGaps.length) reason = "cannot_improve_current_gaps";
    else if (isSelected) reason = broadExploration ? "empty_place_broad_exploration" : "lowest_cost_gap_coverage";
    return {
      action: capability.action,
      cost: capability.cost,
      relevantGaps,
      selected: isSelected,
      reason,
    };
  });
  const selectedActions = actionsConsidered.filter((item) => item.selected).map((item) => item.action);
  const skippedActions = actionsConsidered.filter((item) => !item.selected).map((item) => item.action);
  const actionableGaps = new Set(
    actionsConsidered.filter((item) => item.selected).flatMap((item) => item.relevantGaps),
  );
  const stopReason = selectedActions.length
    ? null
    : gaps.some((gap) => !actionableGaps.has(gap))
      ? "current_source_has_no_useful_capability_for_remaining_gaps"
      : "maximum_extraction_budget_reached";

  return {
    initialCoverage: input.coverage,
    gaps,
    actionsConsidered,
    selectedActions,
    skippedActions,
    stopReason,
    broadExploration,
    estimatedModelCallsAvoided: selectedActions.includes("visual") ? 0 : 1,
    estimatedStagesAvoided: skippedActions.length,
  };
}

export function evidenceFromStructuredFacts(input: Array<{
  structured?: { kind?: string; value?: string } | null;
  confidenceScore?: number;
  confidence?: "high" | "medium" | "low";
  sourceSignal?: string;
  sourceUrl?: string | null;
  observedAt?: string | null;
  verifiedAt?: string | null;
  expiresAt?: string | null;
}>): KnowledgeEvidenceInput[] {
  return input.flatMap((fact) => {
    const kind = String(fact.structured?.kind || "").trim();
    const value = String(fact.structured?.value || "").trim();
    if (!kind || !value) return [];
    const confidence = fact.confidenceScore ?? (fact.confidence === "high" ? 0.9 : fact.confidence === "medium" ? 0.7 : 0.45);
    return [{
      kind,
      value,
      confidence,
      sourceType: fact.sourceSignal || null,
      sourceUrl: fact.sourceUrl ?? null,
      observedAt: fact.observedAt ?? null,
      verifiedAt: fact.verifiedAt ?? null,
      expiresAt: fact.expiresAt ?? null,
    }];
  });
}

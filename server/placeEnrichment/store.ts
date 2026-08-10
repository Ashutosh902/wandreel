import { createHash, randomUUID } from "node:crypto";
import { canonicalizeUrl } from "../extraction/url";
import { runExtractionPipeline } from "../extraction";
import { extractMetadata } from "../extraction/metadata";
import { runIntelligencePipeline } from "../intelligence";
import type { ExtractionResult, SourcePlatform, VisualSearchCandidate } from "../extraction/types";
import { getPostgresDatabase, isPostgresConfigured, type PostgresDatabase } from "../auth/postgresAuth";
import { resolveCanonicalPlace, writePlaceEvidence } from "../stroll/informationFoundation";
import type { SavedPlaceForStrollCuration } from "../stroll/curation";
import { extractPlaceKnowledgeFacts, extractPlaceKnowledgeResult, type PlaceKnowledgeGroundingRejection } from "./facts";
import {
  assessKnowledgeCoverage,
  ENRICHMENT_ACTION_CAPABILITIES,
  evidenceFromStructuredFacts,
  planAdaptiveEnrichment,
  type AdaptiveRoutingDecision,
  type KnowledgeCoverageAssessment,
  type KnowledgeEvidenceInput,
} from "./adaptiveRouting";
import type {
  EnrichmentSourceAudit,
  EnrichmentSourceAuditEntry,
  EnrichmentSourceCoverage,
  IdentificationEvidenceSnapshot,
  PlaceEnrichmentExecutionResult,
  PlaceEnrichmentJobStatus,
  PlaceEnrichmentPayload,
} from "./types";

type Queryable = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

type TransactionClient = Queryable & {
  release: () => void;
};

type PlaceEnrichmentJobRow = {
  id: string;
  dedupe_key: string;
  user_id: string | null;
  saved_place_id: string | null;
  canonical_place_id: string | null;
  status: PlaceEnrichmentJobStatus;
  attempts: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  source_url: string | null;
  source_platform: string | null;
  trigger_reason: string;
  last_error: string | null;
  next_retry_at: string;
  last_started_at: string | null;
  completed_at: string | null;
  payload_json: PlaceEnrichmentPayload;
  result_summary_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type TriggerResult = {
  duplicate: boolean;
  reusedExisting?: boolean;
  reuseReason?: string | null;
  job: {
    id: string;
    status: PlaceEnrichmentJobStatus;
    canonicalPlaceId: string | null;
    sourceUrl: string | null;
    createdAt: string;
    updatedAt: string;
  };
};

type EnrichmentAttemptSummary = {
  attemptNumber: number;
  triggerType: "initial" | "retry";
  route: string | null;
  acceptedAfter: string | null;
  ocrFrameCount: number | null;
  visualFrameCount: number | null;
  intelligenceStatus: string | null;
  structuredEntityCount: number;
  knowledgeFactCount: number;
  transcriptChars: number;
  ocrChars: number;
  visualCandidate: boolean;
  sourceCoverage: EnrichmentSourceCoverage;
  sourceAudit: EnrichmentSourceAudit;
  observedAt: string;
  verifiedAt: string;
  escalationReason: string | null;
  terminalReason: string | null;
  adaptive?: {
    coverageBefore: KnowledgeCoverageAssessment;
    coverageAfter: KnowledgeCoverageAssessment;
    gapsBefore: string[];
    gapsAfter: string[];
    actionsSelected: string[];
    actionsSkipped: string[];
    decisionReason: string;
  };
};

const PLACE_ENRICHMENT_EXTRACTION_VERSION = "deep_v2";
const PLACE_KNOWLEDGE_SCHEMA_VERSION = "place_knowledge_v4";

function toSavedPlaceRecord(input: PlaceEnrichmentPayload["savedPlace"]): SavedPlaceForStrollCuration {
  return {
    id: input.id,
    placeId: input.placeId,
    title: input.title,
    category: input.category,
    metadata: input.metadata,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function normalizeText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function boundedSnapshotText(value: unknown, maxLength = 8_000) {
  return String(value || "").split("\u0000").join("").trim().slice(0, maxLength);
}

function optionalSnapshotText(value: unknown, maxLength?: number) {
  return boundedSnapshotText(value, maxLength) || null;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeVisualCandidateRecord(value: unknown): Record<string, unknown> | null {
  const candidate = objectRecord(value);
  if (!candidate) return null;
  const candidateName = optionalSnapshotText(candidate.candidateName, 500);
  const visualEvidence = optionalSnapshotText(candidate.visualEvidence, 2_000);
  if (!candidateName && !visualEvidence) return null;
  return {
    candidateName,
    formattedAddress: optionalSnapshotText(candidate.formattedAddress, 1_000),
    locality: optionalSnapshotText(candidate.locality, 300),
    city: optionalSnapshotText(candidate.city, 300),
    state: optionalSnapshotText(candidate.state, 300),
    country: optionalSnapshotText(candidate.country, 300),
    placeId: optionalSnapshotText(candidate.placeId, 500),
    query: optionalSnapshotText(candidate.query, 1_000),
    visualEvidence,
    supportFrameLabels: Array.isArray(candidate.supportFrameLabels)
      ? candidate.supportFrameLabels.slice(0, 20).map((item) => boundedSnapshotText(item, 200)).filter(Boolean)
      : [],
    verificationConfidence: ["high", "medium", "low"].includes(String(candidate.verificationConfidence))
      ? candidate.verificationConfidence
      : "low",
    lat: finiteNumber(candidate.lat),
    lng: finiteNumber(candidate.lng),
  };
}

function sanitizePlaceResolutionRecord(value: unknown): Record<string, unknown> | null {
  const resolution = objectRecord(value);
  if (!resolution) return null;
  const intent = objectRecord(resolution.intent);
  const name = optionalSnapshotText(resolution.name, 500);
  const evidenceText = optionalSnapshotText(resolution.evidenceText, 2_000);
  if (!name && !evidenceText) return null;
  return {
    name,
    category: optionalSnapshotText(resolution.category, 100),
    locality: optionalSnapshotText(resolution.locality, 300),
    city: optionalSnapshotText(resolution.city, 300),
    state: optionalSnapshotText(resolution.state, 300),
    country: optionalSnapshotText(resolution.country, 300),
    fullAddress: optionalSnapshotText(resolution.fullAddress, 1_000),
    placeId: optionalSnapshotText(resolution.placeId, 500),
    lat: finiteNumber(resolution.lat),
    lng: finiteNumber(resolution.lng),
    confidence: ["high", "medium", "low"].includes(String(resolution.confidence)) ? resolution.confidence : null,
    evidenceText,
    intent: intent
      ? {
          l1: optionalSnapshotText(intent.l1, 100),
          l2: optionalSnapshotText(intent.l2, 100),
          l3: Array.isArray(intent.l3)
            ? intent.l3.slice(0, 20).map((item) => boundedSnapshotText(item, 200)).filter(Boolean)
            : [],
        }
      : null,
  };
}

export function sanitizeIdentificationEvidenceSnapshot(value: unknown): IdentificationEvidenceSnapshot | null {
  const input = objectRecord(value);
  if (!input || input.version !== "identification_evidence_v1") return null;
  const metadata = objectRecord(input.metadata) || {};
  const transcript = objectRecord(input.transcript);
  const ocr = objectRecord(input.ocr);
  const visual = objectRecord(input.visual);
  const transcriptText = boundedSnapshotText(transcript?.text);
  const ocrText = boundedSnapshotText(ocr?.text);
  const transcriptSegments = Array.isArray(transcript?.segments)
    ? transcript.segments.slice(0, 200).flatMap((item) => {
        const segment = objectRecord(item);
        const text = boundedSnapshotText(segment?.text, 2_000);
        if (!text) return [];
        return [{ text, startMs: finiteNumber(segment?.startMs), endMs: finiteNumber(segment?.endMs) }];
      })
    : [];
  const ocrRegions = Array.isArray(ocr?.regions)
    ? ocr.regions.slice(0, 100).flatMap((item) => {
        const region = objectRecord(item);
        const text = boundedSnapshotText(region?.text, 2_000);
        if (!text) return [];
        const rawBox = objectRecord(region?.boundingBox);
        const values = rawBox
          ? [finiteNumber(rawBox.x), finiteNumber(rawBox.y), finiteNumber(rawBox.width), finiteNumber(rawBox.height)]
          : [];
        return [{
          text,
          frameLabel: optionalSnapshotText(region?.frameLabel, 200),
          frameIndex: finiteNumber(region?.frameIndex),
          timestampSec: finiteNumber(region?.timestampSec),
          boundingBox: values.length === 4 && values.every((entry) => entry !== null)
            ? { x: values[0]!, y: values[1]!, width: values[2]!, height: values[3]! }
            : null,
        }];
      })
    : [];
  const selectedCandidate = sanitizeVisualCandidateRecord(visual?.selectedCandidate);
  const visualScreenshots = Array.isArray(visual?.screenshots)
    ? visual.screenshots.slice(0, 20).flatMap((item) => {
        const screenshot = objectRecord(item);
        const label = boundedSnapshotText(screenshot?.label, 200);
        return label ? [{
          label,
          frameIndex: finiteNumber(screenshot?.frameIndex),
          timestampSec: finiteNumber(screenshot?.timestampSec),
        }] : [];
      })
    : [];
  const observedAtRaw = optionalSnapshotText(input.observedAt, 100);
  const observedAt = observedAtRaw && !Number.isNaN(Date.parse(observedAtRaw)) ? observedAtRaw : null;
  const attemptNumber = Number(input.attemptNumber);

  return {
    version: "identification_evidence_v1",
    observedAt,
    attemptNumber: Number.isInteger(attemptNumber) && attemptNumber >= 1 && attemptNumber <= 3 ? attemptNumber : null,
    acceptedAfter: optionalSnapshotText(input.acceptedAfter, 100),
    metadata: {
      title: optionalSnapshotText(metadata.title, 1_000),
      description: optionalSnapshotText(metadata.description),
      siteName: optionalSnapshotText(metadata.siteName, 200),
      imageUrl: optionalSnapshotText(metadata.imageUrl, 2_000),
      provider: optionalSnapshotText(metadata.provider, 100),
    },
    transcript: transcriptText
      ? {
          text: transcriptText,
          source: optionalSnapshotText(transcript?.source, 100),
          ...(transcriptSegments.length ? { segments: transcriptSegments } : {}),
        }
      : null,
    ocr: ocrText
      ? {
          text: ocrText,
          provider: optionalSnapshotText(ocr?.provider, 100),
          ...(ocrRegions.length ? { regions: ocrRegions } : {}),
        }
      : null,
    visual: selectedCandidate || optionalSnapshotText(visual?.summaryText, 2_000)
      ? {
          summaryText: optionalSnapshotText(visual?.summaryText, 2_000),
          selectedCandidate,
          ...(visualScreenshots.length ? { screenshots: visualScreenshots } : {}),
        }
      : null,
    placeResolution: sanitizePlaceResolutionRecord(input.placeResolution),
  };
}

function normalizedSourcePlatform(value: string | null): SourcePlatform {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized.includes("instagram")) return "instagram";
  if (normalized.includes("youtube")) return "youtube";
  return "web";
}

function snapshotVisualCandidate(value: Record<string, unknown> | null): VisualSearchCandidate | null {
  if (!value) return null;
  const confidence = ["high", "medium", "low"].includes(String(value.verificationConfidence))
    ? value.verificationConfidence as "high" | "medium" | "low"
    : "low";
  return {
    query: normalizeText(value.query),
    source: "vision_search",
    rationale: "Reused from place identification.",
    candidateName: optionalSnapshotText(value.candidateName, 500),
    formattedAddress: optionalSnapshotText(value.formattedAddress, 1_000),
    locality: optionalSnapshotText(value.locality, 300),
    city: optionalSnapshotText(value.city, 300),
    state: optionalSnapshotText(value.state, 300),
    country: optionalSnapshotText(value.country, 300),
    placeId: optionalSnapshotText(value.placeId, 500),
    lat: finiteNumber(value.lat),
    lng: finiteNumber(value.lng),
    visualEvidence: optionalSnapshotText(value.visualEvidence, 2_000),
    supportFrameLabels: Array.isArray(value.supportFrameLabels)
      ? value.supportFrameLabels.map((item) => boundedSnapshotText(item, 200)).filter(Boolean)
      : [],
    verificationConfidence: confidence,
    rankingScore: confidence === "high" ? 1 : confidence === "medium" ? 0.7 : 0.4,
    matchedSignals: ["place_identification"],
  };
}

export function extractionFromIdentificationEvidence(input: {
  snapshot: IdentificationEvidenceSnapshot;
  sourceUrl: string;
  sourcePlatform: string | null;
}): ExtractionResult {
  const platform = normalizedSourcePlatform(input.sourcePlatform);
  const visualCandidate = snapshotVisualCandidate(input.snapshot.visual?.selectedCandidate ?? null);
  const provider = ["html", "youtube_script", "instagram_script", "fallback"].includes(String(input.snapshot.metadata.provider))
    ? input.snapshot.metadata.provider as "html" | "youtube_script" | "instagram_script" | "fallback"
    : "fallback";
  const transcriptSource = ["captions", "whisper"].includes(String(input.snapshot.transcript?.source))
    ? input.snapshot.transcript?.source as "captions" | "whisper"
    : null;
  const transcript = input.snapshot.transcript
    ? {
        attempted: true,
        used: true,
        source: transcriptSource,
        text: input.snapshot.transcript.text,
        reason: null,
        segments: input.snapshot.transcript.segments,
      }
    : null;
  const ocr = input.snapshot.ocr
    ? {
        attempted: true,
        used: true,
        text: input.snapshot.ocr.text,
        reason: null,
        provider: input.snapshot.ocr.provider,
        regions: input.snapshot.ocr.regions,
      }
    : null;
  const visualFallback = input.snapshot.visual
    ? {
        attempted: true,
        triggered: true,
        reason: visualCandidate ? null : "identification_visual_summary_only",
        provider: "shared_visual_fallback" as const,
        confidence: visualCandidate?.verificationConfidence ?? "low" as const,
        needsReview: visualCandidate?.verificationConfidence !== "high",
        screenshots: (input.snapshot.visual.screenshots || []).map((screenshot) => ({
          url: "",
          origin: "video_frame" as const,
          label: screenshot.label,
          frameIndex: screenshot.frameIndex,
          timestampSec: screenshot.timestampSec,
        })),
        textQueries: [],
        visualQueries: [],
        candidates: visualCandidate ? [visualCandidate] : [],
        selectedCandidate: visualCandidate,
        summaryText: input.snapshot.visual.summaryText || visualCandidate?.visualEvidence || "",
      }
    : null;
  return {
    mode: "deep",
    metadata: {
      sourceUrl: input.sourceUrl,
      canonicalUrl: input.sourceUrl,
      platform,
      title: input.snapshot.metadata.title || "",
      description: input.snapshot.metadata.description || "",
      siteName: input.snapshot.metadata.siteName,
      imageUrl: input.snapshot.metadata.imageUrl,
      fetchedAtIso: input.snapshot.observedAt || new Date().toISOString(),
      provider,
    },
    transcript,
    ocr,
    visualFallback,
    attemptInfo: {
      attemptNumber: input.snapshot.attemptNumber || 1,
      triggerType: "initial",
    },
    source: input.sourceUrl,
    platform,
    canonicalUrl: input.sourceUrl,
    combinedTextRaw: [input.snapshot.metadata.description, transcript?.text, ocr?.text, visualFallback?.summaryText].filter(Boolean).join("\n"),
    debug: {
      identificationEvidence: {
        reused: true,
        acceptedAfter: input.snapshot.acceptedAfter,
      },
    },
  };
}

export function mergeIdentificationEvidence(
  extraction: ExtractionResult,
  snapshot: IdentificationEvidenceSnapshot | null,
  sourcePlatform: string | null,
): ExtractionResult {
  if (!snapshot) return extraction;
  const seed = extractionFromIdentificationEvidence({
    snapshot,
    sourceUrl: extraction.metadata.canonicalUrl || extraction.canonicalUrl,
    sourcePlatform,
  });
  return {
    ...extraction,
    metadata: {
      ...extraction.metadata,
      title: seed.metadata.title || extraction.metadata.title,
      description: seed.metadata.description || extraction.metadata.description,
      siteName: seed.metadata.siteName || extraction.metadata.siteName,
      imageUrl: seed.metadata.imageUrl || extraction.metadata.imageUrl,
      fetchedAtIso: snapshot.observedAt || extraction.metadata.fetchedAtIso,
    },
    transcript: seed.transcript?.text ? seed.transcript : extraction.transcript,
    ocr: seed.ocr?.text ? seed.ocr : extraction.ocr,
    visualFallback: seed.visualFallback?.selectedCandidate ? seed.visualFallback : extraction.visualFallback,
    combinedTextRaw: [seed.combinedTextRaw, extraction.combinedTextRaw].filter(Boolean).join("\n"),
    debug: {
      ...(extraction.debug || {}),
      identificationEvidence: {
        reused: true,
        acceptedAfter: snapshot.acceptedAfter,
        transcriptReused: Boolean(seed.transcript?.text),
        ocrReused: Boolean(seed.ocr?.text),
        visualReused: Boolean(seed.visualFallback?.selectedCandidate),
      },
    },
  };
}

function sourceUrlFromSavedPlace(place: SavedPlaceForStrollCuration) {
  const metadata = metadataRecord(place.metadata);
  const raw = normalizeText(metadata.videoUrl) || normalizeText(metadata.sourceUrl) || normalizeText(metadata.canonicalUrl);
  return raw ? canonicalizeUrl(raw) : null;
}

function sourcePlatformFromSavedPlace(place: SavedPlaceForStrollCuration) {
  const metadata = metadataRecord(place.metadata);
  return normalizeText(metadata.sourcePlatform) || normalizeText(metadata.source) || null;
}

function buildDedupeKey(canonicalPlaceId: string | null, place: SavedPlaceForStrollCuration, sourceUrl: string | null) {
  return buildVersionedDedupeKey({
    canonicalPlaceId,
    place,
    sourceUrl,
    contentFingerprint: null,
  });
}

function buildVersionedDedupeKey(input: {
  canonicalPlaceId: string | null;
  place: SavedPlaceForStrollCuration;
  sourceUrl: string | null;
  contentFingerprint: string | null;
}) {
  const raw = JSON.stringify({
    canonicalPlaceId: input.canonicalPlaceId,
    placeId: input.place.placeId,
    title: input.place.title.toLowerCase(),
    sourceUrl: input.sourceUrl || null,
    contentFingerprint: input.contentFingerprint || null,
    extractionVersion: PLACE_ENRICHMENT_EXTRACTION_VERSION,
    knowledgeSchemaVersion: PLACE_KNOWLEDGE_SCHEMA_VERSION,
  });
  return createHash("sha256").update(raw).digest("hex");
}

function buildBackoffMs(attempts: number) {
  return Math.min(60_000, Math.max(5_000, 5_000 * Math.max(1, attempts)));
}

function fingerprint(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function normalizeEvidenceFingerprintValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeEvidenceFingerprintValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (
      key === "sourceRecordId" ||
      key === "observedAt" ||
      key === "verifiedAt" ||
      key === "expiresAt"
    ) {
      continue;
    }
    out[key] = normalizeEvidenceFingerprintValue(child);
  }
  return out;
}

function normalizeFingerprintText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function buildCheapSourceContentFingerprint(input: {
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  siteName?: string | null;
  provider?: string | null;
  canonicalUrl?: string | null;
  sourcePlatform?: string | null;
}) {
  const payload = {
    title: normalizeFingerprintText(input.title),
    description: normalizeFingerprintText(input.description),
    imageUrl: normalizeFingerprintText(input.imageUrl),
    siteName: normalizeFingerprintText(input.siteName),
    provider: normalizeFingerprintText(input.provider),
    canonicalUrl: normalizeFingerprintText(input.canonicalUrl),
    sourcePlatform: normalizeFingerprintText(input.sourcePlatform),
  };
  return fingerprint(payload);
}

function cheapFingerprintSeedFromSavedPlace(place: SavedPlaceForStrollCuration) {
  const metadata = metadataRecord(place.metadata);
  const description =
    normalizeText(metadata.description) ||
    normalizeText(metadata.caption) ||
    normalizeText(metadata.latestDescription) ||
    null;
  const imageUrl =
    normalizeText(metadata.imageUrl) ||
    normalizeText(metadata.thumbnailUrl) ||
    null;
  const siteName =
    normalizeText(metadata.siteName) ||
    normalizeText(metadata.providerName) ||
    null;
  if (!description && !imageUrl && !siteName) return null;
  return buildCheapSourceContentFingerprint({
    title: place.title,
    description,
    imageUrl,
    siteName,
    provider: normalizeText(metadata.provider) || null,
    canonicalUrl: sourceUrlFromSavedPlace(place),
    sourcePlatform: sourcePlatformFromSavedPlace(place),
  });
}

async function insertEvidenceRow(client: Queryable, input: {
  canonicalPlaceId: string;
  factType: string;
  factValue: unknown;
  sourceType: string;
  sourceUrl: string | null;
  sourceRecordId: string | null;
  confidence: number;
  observedAt?: string | null;
  verifiedAt?: string | null;
  expiresAt?: string | null;
  extractionVersion?: string | null;
  intelligenceVersion?: string | null;
  originalPayload: unknown;
}) {
  const evidenceFingerprint = fingerprint({
    factType: input.factType,
    factValue: normalizeEvidenceFingerprintValue(input.factValue),
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
  });

  await client.query(
    `insert into place_source_evidence (
       place_id, fact_type, fact_value_json, source_type, source_url, source_record_id,
       confidence, observed_at, verified_at, expires_at, extraction_version, intelligence_version,
       evidence_fingerprint, original_payload_json, created_at
     )
     values ($1, $2, $3::jsonb, $4, $5, $6, $7, coalesce($8::timestamptz, now()), $9::timestamptz, $10::timestamptz, $11, $12, $13, $14::jsonb, now())
     on conflict (place_id, fact_type, evidence_fingerprint) do nothing`,
    [
      input.canonicalPlaceId,
      input.factType,
      JSON.stringify(input.factValue ?? {}),
      input.sourceType,
      input.sourceUrl,
      input.sourceRecordId,
      input.confidence,
      input.observedAt ?? null,
      input.verifiedAt ?? null,
      input.expiresAt ?? null,
      input.extractionVersion ?? null,
      input.intelligenceVersion ?? null,
      evidenceFingerprint,
      JSON.stringify(input.originalPayload ?? {}),
    ],
  );
}

async function loadCanonicalKnowledgeEvidence(client: Queryable, canonicalPlaceId: string): Promise<KnowledgeEvidenceInput[]> {
  const result = await client.query<{
    fact_value_json: Record<string, any>;
    source_type: string | null;
    source_url: string | null;
    confidence: number | string | null;
    observed_at: string | null;
    verified_at: string | null;
    expires_at: string | null;
  }>(
    `select fact_value_json, source_type, source_url, confidence, observed_at, verified_at, expires_at
     from place_source_evidence
     where place_id = $1
       and fact_type like 'knowledge_%'
       and fact_value_json -> 'structured' ->> 'kind' is not null`,
    [canonicalPlaceId],
  );

  return result.rows.flatMap((row) => {
    const structured = row.fact_value_json?.structured;
    const kind = normalizeText(structured?.kind);
    const value = normalizeText(structured?.value);
    if (!kind || !value) return [];
    return [{
      kind,
      value,
      confidence: Number(row.confidence ?? row.fact_value_json?.confidenceScore ?? 0) || 0,
      sourceType: row.source_type,
      sourceUrl: row.source_url,
      observedAt: row.observed_at,
      verifiedAt: row.verified_at,
      expiresAt: row.expires_at,
    }];
  });
}

export type GroundedPlaceKnowledgeRecord = {
  evidenceId: string;
  factType: string;
  kind: string;
  value: string;
  qualifiers: Record<string, unknown>;
  factConfidence: number;
  grounding: NonNullable<ReturnType<typeof extractPlaceKnowledgeFacts>[number]["grounding"]>;
  provenance: Record<string, unknown> | null;
  sourceUrl: string | null;
  sourceType: string | null;
  sourceRecordId: string | null;
  extractorVersion: string | null;
  model: string | null;
  observedAt: string | null;
  verifiedAt: string | null;
  expiresAt: string | null;
};

export async function loadGroundedPlaceKnowledge(
  database: Pick<PostgresDatabase, "query">,
  canonicalPlaceId: string,
): Promise<GroundedPlaceKnowledgeRecord[]> {
  const result = await database.query<{
    id: string;
    fact_type: string;
    fact_value_json: Record<string, any>;
    source_url: string | null;
    source_type: string | null;
    source_record_id: string | null;
    extraction_version: string | null;
    intelligence_version: string | null;
    confidence: number | string | null;
    observed_at: string | null;
    verified_at: string | null;
    expires_at: string | null;
  }>(
    `select id, fact_type, fact_value_json, source_url, source_type, source_record_id,
            extraction_version, intelligence_version, confidence,
            observed_at, verified_at, expires_at
     from place_source_evidence
     where place_id = $1
       and fact_type like 'knowledge_%'
       and fact_value_json -> 'structured' ->> 'kind' is not null
       and fact_value_json -> 'grounding' -> 'validation' ->> 'status' = 'validated'
     order by created_at asc`,
    [canonicalPlaceId],
  );
  return result.rows.map((row) => ({
    evidenceId: row.id,
    factType: row.fact_type,
    kind: normalizeText(row.fact_value_json.structured.kind),
    value: normalizeText(row.fact_value_json.structured.value),
    qualifiers: objectRecord(row.fact_value_json.structured.qualifiers) || {},
    factConfidence: Number(row.confidence ?? row.fact_value_json.confidenceScore ?? 0) || 0,
    grounding: row.fact_value_json.grounding,
    provenance: objectRecord(row.fact_value_json.provenance),
    sourceUrl: row.source_url,
    sourceType: row.source_type,
    sourceRecordId: row.source_record_id,
    extractorVersion: row.extraction_version,
    model: row.intelligence_version,
    observedAt: row.observed_at,
    verifiedAt: row.verified_at,
    expiresAt: row.expires_at,
  }));
}

function unresolvedCoverageKinds(coverage: KnowledgeCoverageAssessment) {
  return Object.entries(coverage)
    .filter(([, entry]) => entry.status !== "sufficient")
    .map(([kind]) => kind);
}

function addDaysIso(days: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString();
}

function freshnessDaysForFactType(factType: string) {
  if (factType === "transcript") return 365;
  if (factType === "ocr_text") return 365;
  if (factType === "comment_signal") return 180;
  if (factType === "source_caption") return 365;
  if (factType === "source_metadata") return 365;
  if (factType === "visual_candidate") return 365;
  if (factType === "place_resolution") return 540;
  if (factType === "location_metadata") return 540;
  if (factType.startsWith("knowledge_timing")) return 180;
  if (factType.startsWith("knowledge_practical_information")) return 180;
  if (factType.startsWith("knowledge_transport")) return 180;
  if (factType.startsWith("knowledge_food")) return 365;
  return 730;
}

function confidenceLabelToScore(value: "high" | "medium" | "low") {
  return value === "high" ? 0.9 : value === "medium" ? 0.7 : 0.45;
}

function inferSourceType(signal: "caption" | "transcript" | "ocr" | "comment" | "visual" | "intelligence" | "saved_place", sourcePlatform: string | null) {
  const platform = normalizeText(sourcePlatform).toLowerCase() || "unknown";
  if (signal === "caption") return `${platform}_caption`;
  if (signal === "transcript") return `${platform}_transcript`;
  if (signal === "ocr") return `${platform}_ocr`;
  if (signal === "comment") return `${platform}_comments`;
  if (signal === "visual") return `${platform}_vision`;
  if (signal === "intelligence") return "llm_structured_enrichment";
  return "saved_place_seed";
}

async function writeIdentificationSnapshotEvidence(client: Queryable, input: {
  canonicalPlaceId: string;
  jobId: string;
  sourceUrl: string;
  sourcePlatform: string | null;
  snapshot: IdentificationEvidenceSnapshot;
  facts: ReturnType<typeof extractPlaceKnowledgeFacts>;
}) {
  const extraction = extractionFromIdentificationEvidence({
    snapshot: input.snapshot,
    sourceUrl: input.sourceUrl,
    sourcePlatform: input.sourcePlatform,
  });
  const observedAt = input.snapshot.observedAt || new Date().toISOString();
  const verifiedAt = new Date().toISOString();
  const base = {
    canonicalPlaceId: input.canonicalPlaceId,
    sourceUrl: input.sourceUrl,
    observedAt,
    verifiedAt,
    extractionVersion: PLACE_ENRICHMENT_EXTRACTION_VERSION,
  };
  const insertTextSignal = async (signal: "caption" | "transcript" | "ocr", factType: string, text: string, confidence: number) => {
    const sourceRecordId = `${input.jobId}:identification:${signal}`;
    await insertEvidenceRow(client, {
      ...base,
      factType,
      factValue: {
        text,
        provenance: {
          sourceType: inferSourceType(signal, input.sourcePlatform),
          sourceUrl: input.sourceUrl,
          sourceRecordId,
          extractorVersion: PLACE_ENRICHMENT_EXTRACTION_VERSION,
          model: null,
          originPhase: "place_identification" as const,
        },
      },
      sourceType: inferSourceType(signal, input.sourcePlatform),
      sourceRecordId,
      confidence,
      expiresAt: addDaysIso(freshnessDaysForFactType(factType)),
      originalPayload: { jobId: input.jobId, originPhase: "place_identification" },
    });
  };

  if (input.snapshot.metadata.description) await insertTextSignal("caption", "source_caption", input.snapshot.metadata.description, 0.7);
  if (input.snapshot.transcript?.text) await insertTextSignal("transcript", "transcript", input.snapshot.transcript.text, 0.9);
  if (input.snapshot.ocr?.text) await insertTextSignal("ocr", "ocr_text", input.snapshot.ocr.text, 0.75);

  if (extraction.visualFallback?.selectedCandidate) {
    const candidate = extraction.visualFallback.selectedCandidate;
    await insertEvidenceRow(client, {
      ...base,
      factType: "visual_candidate",
      factValue: {
        candidateName: candidate.candidateName,
        formattedAddress: candidate.formattedAddress,
        placeId: candidate.placeId,
        visualEvidence: candidate.visualEvidence,
        provenance: {
          sourceType: inferSourceType("visual", input.sourcePlatform),
          sourceUrl: input.sourceUrl,
          sourceRecordId: `${input.jobId}:identification:visual`,
          extractorVersion: PLACE_ENRICHMENT_EXTRACTION_VERSION,
          model: null,
          originPhase: "place_identification",
        },
      },
      sourceType: inferSourceType("visual", input.sourcePlatform),
      sourceRecordId: `${input.jobId}:identification:visual`,
      confidence: candidate.verificationConfidence === "high" ? 0.92 : 0.74,
      expiresAt: addDaysIso(freshnessDaysForFactType("visual_candidate")),
      originalPayload: { jobId: input.jobId, originPhase: "place_identification" },
    });
  }

  if (input.snapshot.placeResolution) {
    await insertEvidenceRow(client, {
      ...base,
      factType: "identification_place_resolution",
      factValue: {
        ...input.snapshot.placeResolution,
        provenance: {
          sourceType: "place_identification",
          sourceUrl: input.sourceUrl,
          sourceRecordId: `${input.jobId}:identification:resolution`,
          extractorVersion: PLACE_ENRICHMENT_EXTRACTION_VERSION,
          model: null,
          originPhase: "place_identification",
        },
      },
      sourceType: "place_identification",
      sourceRecordId: `${input.jobId}:identification:resolution`,
      confidence: input.snapshot.placeResolution.confidence === "high" ? 0.9 : 0.7,
      expiresAt: addDaysIso(freshnessDaysForFactType("place_resolution")),
      originalPayload: { jobId: input.jobId, originPhase: "place_identification" },
    });
  }

  for (const fact of input.facts) {
    await insertEvidenceRow(client, {
      ...base,
      factType: `knowledge_${fact.category}`,
      factValue: {
        text: fact.text,
        category: fact.category,
        sourceSignal: fact.sourceSignal,
        confidence: fact.confidence,
        confidenceScore: fact.confidenceScore ?? confidenceLabelToScore(fact.confidence),
        structured: fact.structured ?? null,
        grounding: fact.grounding ?? null,
        provenance: fact.provenance,
        attributes: fact.attributes ?? {},
      },
      sourceType: inferSourceType(fact.sourceSignal, input.sourcePlatform),
      sourceRecordId: `${input.jobId}:identification:knowledge:${fact.category}:${fingerprint(fact.text).slice(0, 12)}`,
      confidence: fact.confidenceScore ?? confidenceLabelToScore(fact.confidence),
      expiresAt: addDaysIso(freshnessDaysForFactType(`knowledge_${fact.category}`)),
      originalPayload: { jobId: input.jobId, originPhase: "place_identification" },
    });
  }
}

function parseResultSummary(row: Pick<PlaceEnrichmentJobRow, "result_summary_json"> | null | undefined) {
  return row?.result_summary_json && typeof row.result_summary_json === "object"
    ? row.result_summary_json as Record<string, unknown>
    : {};
}

function getReusableSourceSignature(input: {
  sourceUrl: string | null;
  sourcePlatform: string | null;
  contentFingerprint: string | null;
}) {
  return JSON.stringify({
    sourceUrl: input.sourceUrl || null,
    sourcePlatform: input.sourcePlatform || null,
    contentFingerprint: input.contentFingerprint || null,
    extractionVersion: PLACE_ENRICHMENT_EXTRACTION_VERSION,
    knowledgeSchemaVersion: PLACE_KNOWLEDGE_SCHEMA_VERSION,
  });
}

function parseReusableSourceSignature(summary: Record<string, unknown>) {
  const raw = summary.reuseSourceSignature;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      sourceUrl: normalizeText(parsed.sourceUrl) || null,
      sourcePlatform: normalizeText(parsed.sourcePlatform) || null,
      contentFingerprint: normalizeText(parsed.contentFingerprint) || null,
      extractionVersion: normalizeText(parsed.extractionVersion) || null,
      knowledgeSchemaVersion: normalizeText(parsed.knowledgeSchemaVersion) || null,
    };
  } catch {
    return null;
  }
}

export function shouldReuseExistingEnrichment(input: {
  previousJob: Pick<PlaceEnrichmentJobRow, "status" | "result_summary_json"> | null;
  sourceUrl: string | null;
  sourcePlatform: string | null;
  contentFingerprint: string | null;
  previousContentFingerprint?: string | null;
}) {
  const row = input.previousJob;
  if (!row) return { reuse: false, reason: "no_previous_enrichment" };
  if (row.status !== "completed" && row.status !== "partial") {
    return { reuse: false, reason: "previous_job_not_terminal_success" };
  }

  const summary = parseResultSummary(row);
  const summaryKnowledgeCount = Number(summary.knowledgeFactCount ?? 0) || 0;
  const summaryStructuredEntityCount = Number(summary.structuredEntityCount ?? 0) || 0;
  const signature = parseReusableSourceSignature(summary);
  const previousContentFingerprint = signature?.contentFingerprint || input.previousContentFingerprint || null;
  if (!previousContentFingerprint) {
    return { reuse: false, reason: "previous_job_missing_content_fingerprint" };
  }
  if (!input.contentFingerprint) {
    return { reuse: false, reason: "content_fingerprint_unavailable" };
  }
  if (signature && (signature.sourceUrl !== (input.sourceUrl || null) || signature.sourcePlatform !== (input.sourcePlatform || null))) {
    return { reuse: false, reason: "source_identity_changed" };
  }
  if (
    signature &&
    signature.extractionVersion !== PLACE_ENRICHMENT_EXTRACTION_VERSION ||
    signature &&
    signature.knowledgeSchemaVersion !== PLACE_KNOWLEDGE_SCHEMA_VERSION
  ) {
    return { reuse: false, reason: "enrichment_version_or_source_signature_changed" };
  }
  if (previousContentFingerprint !== input.contentFingerprint) {
    return { reuse: false, reason: "source_content_changed" };
  }

  if (summaryKnowledgeCount <= 0 && summaryStructuredEntityCount <= 0) {
    return { reuse: false, reason: "previous_job_missing_reusable_knowledge" };
  }

  return { reuse: true, reason: "same_source_reused_existing_knowledge" };
}

async function findLatestReusableJob(client: Queryable, input: {
  canonicalPlaceId: string | null;
  sourceUrl: string | null;
}) {
  if (!input.canonicalPlaceId || !input.sourceUrl) return null;
  const result = await client.query<PlaceEnrichmentJobRow>(
    `select *
     from place_enrichment_jobs
     where canonical_place_id = $1
       and source_url = $2
     order by completed_at desc nulls last, updated_at desc, created_at desc
     limit 1`,
    [input.canonicalPlaceId, input.sourceUrl],
  );
  return result.rows[0] ?? null;
}

async function findInFlightJob(client: Queryable, input: {
  canonicalPlaceId: string | null;
  sourceUrl: string | null;
}) {
  if (!input.canonicalPlaceId || !input.sourceUrl) return null;
  const result = await client.query<PlaceEnrichmentJobRow>(
    `select *
     from place_enrichment_jobs
     where canonical_place_id = $1
       and source_url = $2
       and status in ('pending', 'running')
     order by updated_at desc, created_at desc
     limit 1`,
    [input.canonicalPlaceId, input.sourceUrl],
  );
  return result.rows[0] ?? null;
}

async function loadStoredSourceContentFingerprint(client: Queryable, input: {
  canonicalPlaceId: string | null;
  sourceUrl: string | null;
  sourcePlatform: string | null;
}) {
  if (!input.canonicalPlaceId || !input.sourceUrl) return null;
  const result = await client.query<{ fact_type: string; fact_value_json: any }>(
    `select fact_type, fact_value_json
     from place_source_evidence
     where place_id = $1
       and source_url = $2
       and fact_type in ('source_caption', 'source_metadata')
     order by created_at desc`,
    [input.canonicalPlaceId, input.sourceUrl],
  );

  const sourceMetadata = result.rows.find((row) => row.fact_type === "source_metadata")?.fact_value_json ?? {};
  const sourceCaption = result.rows.find((row) => row.fact_type === "source_caption")?.fact_value_json ?? {};
  if (!Object.keys(sourceMetadata || {}).length && !Object.keys(sourceCaption || {}).length) {
    return null;
  }

  return buildCheapSourceContentFingerprint({
    title: sourceMetadata.title ?? null,
    description: sourceCaption.text ?? null,
    imageUrl: sourceMetadata.imageUrl ?? null,
    siteName: sourceMetadata.siteName ?? null,
    provider: sourceMetadata.provider ?? null,
    canonicalUrl: input.sourceUrl,
    sourcePlatform: input.sourcePlatform,
  });
}

function extractionDebugValue(extraction: Awaited<ReturnType<typeof runExtractionPipeline>>, key: "route" | "acceptedAfter") {
  const debug = extraction.debug && typeof extraction.debug === "object"
    ? extraction.debug as Record<string, unknown>
    : null;
  const orchestration = debug?.orchestration && typeof debug.orchestration === "object"
    ? debug.orchestration as Record<string, unknown>
    : null;
  const value = orchestration?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function extractionDebugNumber(extraction: Awaited<ReturnType<typeof runExtractionPipeline>>, key: "ocrFrameCount" | "visualFrameCount") {
  const debug = extraction.debug && typeof extraction.debug === "object"
    ? extraction.debug as Record<string, unknown>
    : null;
  const orchestration = debug?.orchestration && typeof debug.orchestration === "object"
    ? debug.orchestration as Record<string, unknown>
    : null;
  const value = orchestration?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function shouldEscalateEnrichmentAttempt(input: {
  attemptNumber: number;
  acceptedAfter: string | null;
  intelligenceStatus: string | null;
}) {
  if (input.attemptNumber >= 3) return null;
  if (input.acceptedAfter === "manual_review") {
    return "manual_review_requires_deeper_evidence";
  }
  if (input.intelligenceStatus === "needs_review") {
    return "intelligence_needs_review";
  }
  if (input.intelligenceStatus === "no_supported_entity_found") {
    return "no_supported_entity_found";
  }
  return null;
}

function mergeCoverageEntries(entries: EnrichmentSourceCoverage[]): EnrichmentSourceCoverage {
  const merged: EnrichmentSourceCoverage = {
    caption: false,
    transcript: false,
    ocr: false,
    visual: false,
    comments: false,
    creatorMetadata: false,
    locationMetadata: false,
    structuredIntelligence: false,
    googleMaps: false,
    website: false,
  };

  for (const entry of entries) {
    for (const key of Object.keys(merged) as Array<keyof EnrichmentSourceCoverage>) {
      merged[key] = merged[key] || entry[key];
    }
  }

  return merged;
}

function mergeAuditEntries(entries: EnrichmentSourceAudit[]): EnrichmentSourceAudit {
  const merged = {} as EnrichmentSourceAudit;
  const keys = Object.keys(entries[0] || {}) as Array<keyof EnrichmentSourceAudit>;

  for (const key of keys) {
    const sourceEntries = entries.map((entry) => entry[key]);
    const contributed = sourceEntries.some((entry) => entry.contributed);
    const failed = sourceEntries.some((entry) => entry.failed) && !contributed;
    const noUsableEvidence = !contributed && sourceEntries.some((entry) => entry.noUsableEvidence);
    const latestReason = [...sourceEntries].reverse().find((entry) => entry.reason)?.reason ?? null;
    const latestProvider = [...sourceEntries].reverse().find((entry) => entry.provider)?.provider ?? null;

    merged[key] = {
      available: sourceEntries.some((entry) => entry.available),
      attempted: sourceEntries.some((entry) => entry.attempted),
      contributed,
      failed,
      noUsableEvidence,
      reason: latestReason,
      provider: latestProvider,
    };
  }

  return merged;
}

export function determineEnrichmentTerminalStatus(input: {
  factsCount: number;
  sourceAudit: EnrichmentSourceAudit;
}) {
  const usefulEvidence =
    input.factsCount > 0 ||
    Object.values(input.sourceAudit).some((entry) => entry.contributed);
  if (!usefulEvidence) {
    return "partial" as const;
  }

  const hasUnresolvedAttemptedSource = Object.values(input.sourceAudit).some(
    (entry) => entry.attempted && !entry.contributed,
  );
  return hasUnresolvedAttemptedSource ? "partial" as const : "completed" as const;
}

function summarizeAttempt(input: {
  attemptNumber: number;
  triggerType: "initial" | "retry";
  extraction: Awaited<ReturnType<typeof runExtractionPipeline>>;
  intelligence: Awaited<ReturnType<typeof runIntelligencePipeline>>;
  place: SavedPlaceForStrollCuration;
  sourcePlatform: string | null;
  sourceUrl: string | null;
}): EnrichmentAttemptSummary {
  const facts = extractPlaceKnowledgeFacts({
    extraction: input.extraction,
    intelligence: input.intelligence,
  });
  const sourceCoverage = buildCoverageAudit({
    sourcePlatform: input.sourcePlatform,
    sourceUrl: input.sourceUrl,
    extraction: input.extraction,
    intelligence: input.intelligence,
    place: input.place,
  });
  const sourceAudit = buildSourceAudit({
    sourceCoverage,
    extraction: input.extraction,
    intelligence: input.intelligence,
    place: input.place,
  });
  const observedAt = input.extraction.metadata.fetchedAtIso || new Date().toISOString();
  const verifiedAt = new Date().toISOString();
  const acceptedAfter = extractionDebugValue(input.extraction, "acceptedAfter");
  const intelligenceStatus = input.intelligence.output.status ?? null;
  const escalationReason = shouldEscalateEnrichmentAttempt({
    attemptNumber: input.attemptNumber,
    acceptedAfter,
    intelligenceStatus,
  });

  return {
    attemptNumber: input.attemptNumber,
    triggerType: input.triggerType,
    route: extractionDebugValue(input.extraction, "route"),
    acceptedAfter,
    ocrFrameCount: extractionDebugNumber(input.extraction, "ocrFrameCount"),
    visualFrameCount: extractionDebugNumber(input.extraction, "visualFrameCount"),
    intelligenceStatus,
    structuredEntityCount: input.intelligence.output.structuredEntities.length,
    knowledgeFactCount: facts.length,
    transcriptChars: String(input.extraction.transcript?.text || "").length,
    ocrChars: String(input.extraction.ocr?.text || "").length,
    visualCandidate: Boolean(input.extraction.visualFallback?.selectedCandidate),
    sourceCoverage,
    sourceAudit,
    observedAt,
    verifiedAt,
    escalationReason,
    terminalReason: escalationReason ? null : intelligenceStatus || acceptedAfter || "resolved",
  };
}

function buildCoverageAudit(input: {
  sourcePlatform: string | null;
  sourceUrl: string | null;
  extraction: Awaited<ReturnType<typeof runExtractionPipeline>>;
  intelligence: Awaited<ReturnType<typeof runIntelligencePipeline>>;
  place: SavedPlaceForStrollCuration;
}): EnrichmentSourceCoverage {
  const metadata = metadataRecord(input.place.metadata);
  const platform = normalizeText(input.sourcePlatform).toLowerCase();
  return {
    caption: Boolean(String(input.extraction.metadata.description || "").trim()),
    transcript: Boolean(String(input.extraction.transcript?.text || "").trim()),
    ocr: Boolean(String(input.extraction.ocr?.text || "").trim()),
    visual: Boolean(input.extraction.visualFallback?.selectedCandidate),
    comments: Boolean(
      input.extraction.metadata.commentEvidence?.pinnedComment ||
      (input.extraction.metadata.commentEvidence?.topComments || []).length ||
      (input.extraction.metadata.commentEvidence?.creatorReplies || []).length
    ),
    creatorMetadata: Boolean(String(input.extraction.metadata.title || "").trim()),
    locationMetadata: Boolean(
      normalizeText(metadata.locality) ||
      normalizeText(metadata.city) ||
      normalizeText(metadata.fullAddress) ||
      normalizeText(metadata.state) ||
      normalizeText(metadata.country)
    ),
    structuredIntelligence: Boolean(input.intelligence.output.structuredEntities.length),
    googleMaps: Boolean(
      normalizeText(metadata.googlePlaceId) ||
      normalizeText(metadata.google_place_id) ||
      normalizeText(metadata.googleMapsPlaceId) ||
      input.intelligence.output.structuredEntities.some((entity) => Boolean(entity.placeId || entity.resolvedBy === "google_maps"))
    ),
    website: platform === "website" || platform === "web" || /^https?:\/\//i.test(input.sourceUrl || ""),
  };
}

function buildAuditEntry(input: {
  available: boolean;
  attempted: boolean;
  contributed: boolean;
  reason?: string | null;
  provider?: string | null;
}) : EnrichmentSourceAuditEntry {
  const reason = input.reason ?? null;
  const noUsableReason = Boolean(
    reason === "vision_ocr_empty" ||
    reason === "no_verified_candidates" ||
    reason?.startsWith("no_")
  );
  const failed = input.attempted && !input.contributed && Boolean(reason) && reason !== "not_attempted" && !noUsableReason;
  return {
    available: input.available,
    attempted: input.attempted,
    contributed: input.contributed,
    failed,
    noUsableEvidence: input.attempted && !input.contributed && (!failed || noUsableReason),
    reason,
    provider: input.provider ?? null,
  };
}

function buildSourceAudit(input: {
  sourceCoverage: EnrichmentSourceCoverage;
  extraction: Awaited<ReturnType<typeof runExtractionPipeline>>;
  intelligence: Awaited<ReturnType<typeof runIntelligencePipeline>>;
  place: SavedPlaceForStrollCuration;
}): EnrichmentSourceAudit {
  const metadata = metadataRecord(input.place.metadata);
  const commentEvidence = input.extraction.metadata.commentEvidence;
  const hasLocationMetadata = Boolean(
    normalizeText(metadata.locality) ||
    normalizeText(metadata.city) ||
    normalizeText(metadata.fullAddress) ||
    normalizeText(metadata.state) ||
    normalizeText(metadata.country)
  );
  const hasGoogleMapsResolution = Boolean(
    normalizeText(metadata.googlePlaceId) ||
    normalizeText(metadata.google_place_id) ||
    normalizeText(metadata.googleMapsPlaceId) ||
    input.intelligence.output.structuredEntities.some((entity) => Boolean(entity.placeId || entity.resolvedBy === "google_maps"))
  );

  return {
    caption: buildAuditEntry({
      available: true,
      attempted: true,
      contributed: input.sourceCoverage.caption,
      reason: input.sourceCoverage.caption ? null : "no_caption_text",
      provider: input.extraction.metadata.provider ?? null,
    }),
    transcript: buildAuditEntry({
      available: Boolean(input.extraction.transcript?.attempted || input.extraction.transcript?.reason || input.extraction.transcript?.source),
      attempted: Boolean(input.extraction.transcript?.attempted),
      contributed: input.sourceCoverage.transcript,
      reason: input.extraction.transcript?.reason ?? null,
      provider: input.extraction.transcript?.source ?? null,
    }),
    ocr: buildAuditEntry({
      available: Boolean(input.extraction.ocr?.attempted || input.extraction.ocr?.reason || input.extraction.ocr?.provider),
      attempted: Boolean(input.extraction.ocr?.attempted),
      contributed: input.sourceCoverage.ocr,
      reason: input.extraction.ocr?.reason ?? null,
      provider: input.extraction.ocr?.provider ?? null,
    }),
    visual: buildAuditEntry({
      available: Boolean(input.extraction.visualFallback?.attempted || input.extraction.visualFallback?.triggered || input.extraction.visualFallback?.reason),
      attempted: Boolean(input.extraction.visualFallback?.attempted || input.extraction.visualFallback?.triggered),
      contributed: input.sourceCoverage.visual,
      reason: input.extraction.visualFallback?.reason ?? null,
      provider: input.extraction.visualFallback?.provider ?? null,
    }),
    comments: buildAuditEntry({
      available: Boolean(commentEvidence?.attempted || commentEvidence?.provider || commentEvidence?.pinnedComment),
      attempted: Boolean(commentEvidence?.attempted),
      contributed: input.sourceCoverage.comments,
      reason: commentEvidence?.timedOut ? "timed_out" : commentEvidence?.reason ?? null,
      provider: commentEvidence?.provider ?? null,
    }),
    creatorMetadata: buildAuditEntry({
      available: true,
      attempted: true,
      contributed: input.sourceCoverage.creatorMetadata,
      reason: input.sourceCoverage.creatorMetadata ? null : "no_creator_metadata",
      provider: input.extraction.metadata.provider ?? null,
    }),
    locationMetadata: buildAuditEntry({
      available: true,
      attempted: true,
      contributed: hasLocationMetadata || input.sourceCoverage.locationMetadata,
      reason: hasLocationMetadata || input.sourceCoverage.locationMetadata ? null : "no_location_metadata",
      provider: "saved_place_metadata",
    }),
    structuredIntelligence: buildAuditEntry({
      available: true,
      attempted: true,
      contributed: input.sourceCoverage.structuredIntelligence,
      reason: input.sourceCoverage.structuredIntelligence ? null : "no_structured_entities",
      provider: input.intelligence.providerMeta?.model ?? null,
    }),
    googleMaps: buildAuditEntry({
      available: Boolean(input.intelligence.output.structuredEntities.length || hasGoogleMapsResolution),
      attempted: Boolean(input.intelligence.output.structuredEntities.length || hasGoogleMapsResolution),
      contributed: input.sourceCoverage.googleMaps,
      reason: input.sourceCoverage.googleMaps ? null : "no_google_maps_resolution",
      provider: hasGoogleMapsResolution ? "google_maps" : input.intelligence.providerMeta?.model ?? null,
    }),
    website: buildAuditEntry({
      available: /^https?:\/\//i.test(input.extraction.metadata.canonicalUrl || input.extraction.metadata.sourceUrl || ""),
      attempted: true,
      contributed: input.sourceCoverage.website,
      reason: input.sourceCoverage.website ? null : "no_website_source",
      provider: input.extraction.metadata.siteName ?? null,
    }),
  };
}

export class PlaceEnrichmentJobStore {
  private readonly database: PostgresDatabase;
  private readonly workerId: string;
  private readonly leaseMs: number;
  private readonly metadataExtractor: typeof extractMetadata;
  private readonly extractionRunner: typeof runExtractionPipeline;
  private readonly intelligenceRunner: typeof runIntelligencePipeline;
  private drainScheduled = false;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: {
    database?: PostgresDatabase;
    workerId?: string;
    leaseMs?: number;
    metadataExtractor?: typeof extractMetadata;
    extractionRunner?: typeof runExtractionPipeline;
    intelligenceRunner?: typeof runIntelligencePipeline;
  } = {}) {
    this.database = options.database ?? getPostgresDatabase();
    this.workerId = options.workerId ?? `place-enrichment-${process.pid}-${randomUUID()}`;
    this.leaseMs = options.leaseMs ?? 60_000;
    this.metadataExtractor = options.metadataExtractor ?? extractMetadata;
    this.extractionRunner = options.extractionRunner ?? runExtractionPipeline;
    this.intelligenceRunner = options.intelligenceRunner ?? runIntelligencePipeline;
  }

  start() {
    if (this.pollTimer || process.env.NODE_ENV === "test") return;
    this.pollTimer = setInterval(() => this.kick(), 3_000);
    this.kick();
  }

  stop() {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async recoverStaleJobs() {
    if (!isPostgresConfigured()) return;
    await this.database.query(
      `update place_enrichment_jobs
       set status = 'pending',
           lease_owner = null,
           lease_expires_at = null,
           updated_at = now()
       where status = 'running'
         and lease_expires_at is not null
         and lease_expires_at < now()`,
    ).catch(() => undefined);
  }

  async triggerFromSavedPlace(input: {
    userId: string;
    savedPlace: PlaceEnrichmentPayload["savedPlace"];
    identificationEvidence?: unknown;
  }): Promise<TriggerResult | null> {
    if (!isPostgresConfigured()) return null;
    let client: TransactionClient | null = null;
    try {
      client = await this.database.connect() as TransactionClient;
      await client.query("begin");
      const place = toSavedPlaceRecord(input.savedPlace);
      const identificationEvidence = sanitizeIdentificationEvidenceSnapshot(input.identificationEvidence);
      const resolution = await resolveCanonicalPlace(client, place);
      const canonicalPlaceId = resolution.canonicalPlaceId;
      if (canonicalPlaceId) {
        await writePlaceEvidence(client, canonicalPlaceId, place);
        await client.query(
          "update user_saved_places set canonical_place_id = $2, updated_at = now() where id = $1 and canonical_place_id is null",
          [place.id, canonicalPlaceId],
        );
      }

      const sourceUrl = sourceUrlFromSavedPlace(place);
      const sourcePlatform = sourcePlatformFromSavedPlace(place);
      const inFlightJob = await findInFlightJob(client, {
        canonicalPlaceId,
        sourceUrl,
      });
      if (inFlightJob) {
        await client.query("commit");
        return {
          duplicate: true,
          reusedExisting: false,
          reuseReason: "job_already_in_flight",
          job: {
            id: inFlightJob.id,
            status: inFlightJob.status,
            canonicalPlaceId: inFlightJob.canonical_place_id,
            sourceUrl: inFlightJob.source_url,
            createdAt: inFlightJob.created_at,
            updatedAt: inFlightJob.updated_at,
          },
        };
      }

      const latestForSource = await findLatestReusableJob(client, {
        canonicalPlaceId,
        sourceUrl,
      });
      let currentContentFingerprint = identificationEvidence
        ? buildCheapSourceContentFingerprint({
            title: identificationEvidence.metadata.title || place.title,
            description: identificationEvidence.metadata.description,
            imageUrl: identificationEvidence.metadata.imageUrl,
            siteName: identificationEvidence.metadata.siteName,
            provider: identificationEvidence.metadata.provider,
            canonicalUrl: sourceUrl,
            sourcePlatform,
          })
        : cheapFingerprintSeedFromSavedPlace(place);
      if (!currentContentFingerprint && sourceUrl) {
        try {
          const metadata = await this.metadataExtractor(sourceUrl);
          currentContentFingerprint = buildCheapSourceContentFingerprint({
            title: metadata.title,
            description: metadata.description,
            imageUrl: metadata.imageUrl,
            siteName: metadata.siteName,
            provider: metadata.provider,
            canonicalUrl: metadata.canonicalUrl,
            sourcePlatform: sourcePlatform ?? metadata.platform,
          });
        } catch (error) {
          console.info("place_enrichment_content_fingerprint_unavailable", {
            sourceUrl,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const reuseDecision = shouldReuseExistingEnrichment({
        previousJob: latestForSource,
        sourceUrl,
        sourcePlatform,
        contentFingerprint: currentContentFingerprint,
        previousContentFingerprint: await loadStoredSourceContentFingerprint(client, {
          canonicalPlaceId,
          sourceUrl,
          sourcePlatform,
        }),
      });
      if (reuseDecision.reuse && latestForSource) {
        await client.query("commit");
        return {
          duplicate: true,
          reusedExisting: true,
          reuseReason: reuseDecision.reason,
          job: {
            id: latestForSource.id,
            status: latestForSource.status,
            canonicalPlaceId: latestForSource.canonical_place_id,
            sourceUrl: latestForSource.source_url,
            createdAt: latestForSource.created_at,
            updatedAt: latestForSource.updated_at,
          },
        };
      }

      const dedupeKey = latestForSource
        ? buildVersionedDedupeKey({
            canonicalPlaceId,
            place,
            sourceUrl,
            contentFingerprint: currentContentFingerprint || `refresh:${randomUUID()}`,
          })
        : buildDedupeKey(canonicalPlaceId, place, sourceUrl);
      let row = latestForSource && latestForSource.status === "failed"
        ? latestForSource
        : null;
      const duplicate = false;
      if (row) {
        const retried = await client.query<PlaceEnrichmentJobRow>(
          `update place_enrichment_jobs
           set status = 'pending',
               dedupe_key = $2,
               last_error = null,
               next_retry_at = now(),
               payload_json = $3::jsonb,
               updated_at = now()
           where id = $1
           returning *`,
          [row.id, dedupeKey, JSON.stringify({
            savedPlace: input.savedPlace,
            sourceUrl,
            sourcePlatform,
            contentFingerprint: currentContentFingerprint,
            identificationEvidence,
            resolutionStrategy: resolution.strategy,
          } satisfies PlaceEnrichmentPayload)],
        );
        row = retried.rows[0];
      } else {
        const inserted = await client.query<PlaceEnrichmentJobRow>(
          `insert into place_enrichment_jobs (
             id, dedupe_key, user_id, saved_place_id, canonical_place_id,
             status, source_url, source_platform, trigger_reason, payload_json,
             result_summary_json, created_at, updated_at
           )
           values ($1, $2, $3, $4, $5, 'pending', $6, $7, 'save', $8::jsonb, '{}'::jsonb, now(), now())
           returning *`,
          [
            randomUUID(),
            dedupeKey,
            input.userId,
            place.id,
            canonicalPlaceId,
            sourceUrl,
            sourcePlatform,
            JSON.stringify({
              savedPlace: input.savedPlace,
              sourceUrl,
              sourcePlatform,
              contentFingerprint: currentContentFingerprint,
              identificationEvidence,
              resolutionStrategy: resolution.strategy,
            } satisfies PlaceEnrichmentPayload),
          ],
        );
        row = inserted.rows[0];
      }
      const localLeaseOwner = normalizeText(process.env.PLACE_ENRICHMENT_LOCAL_LEASE_OWNER);
      if (row && localLeaseOwner) {
        const reserved = await client.query<PlaceEnrichmentJobRow>(
          `update place_enrichment_jobs
           set status = 'running',
               attempts = attempts + 1,
               lease_owner = $2,
               lease_expires_at = now() + interval '10 minutes',
               last_started_at = now(),
               updated_at = now()
           where id = $1 and status = 'pending'
           returning *`,
          [row.id, localLeaseOwner],
        );
        row = reserved.rows[0] ?? row;
      }
      await client.query("commit");
      if (!duplicate && !localLeaseOwner) this.kick();
      return row ? {
        duplicate,
        reusedExisting: false,
        reuseReason: reuseDecision.reason,
        job: {
          id: row.id,
          status: row.status,
          canonicalPlaceId: row.canonical_place_id,
          sourceUrl: row.source_url,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      } : null;
    } catch (error) {
      await client?.query("rollback").catch(() => undefined);
      console.warn("place_enrichment_trigger_failed", error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      client?.release();
    }
  }

  async get(jobId: string) {
    if (!isPostgresConfigured()) return null;
    const result = await this.database.query<PlaceEnrichmentJobRow>(
      "select * from place_enrichment_jobs where id = $1 limit 1",
      [jobId],
    );
    return result.rows[0] ?? null;
  }

  private kick() {
    if (this.drainScheduled || this.running || process.env.NODE_ENV === "test") return;
    this.drainScheduled = true;
    setTimeout(() => {
      this.drainScheduled = false;
      void this.drain();
    }, 0);
  }

  private async drain() {
    if (this.running || !isPostgresConfigured()) return;
    this.running = true;
    try {
      while (true) {
        const job = await this.claimNextJob();
        if (!job) break;
        await this.processJob(job);
      }
    } finally {
      this.running = false;
    }
  }

  private async claimNextJob() {
    const client = await this.database.connect() as TransactionClient;
    try {
      await client.query("begin");
      const picked = await client.query<PlaceEnrichmentJobRow>(
        `with candidate as (
           select id
           from place_enrichment_jobs
           where status in ('pending', 'failed')
             and next_retry_at <= now()
           order by created_at asc
           limit 1
           for update skip locked
         )
         update place_enrichment_jobs as jobs
         set status = 'running',
             attempts = jobs.attempts + 1,
             lease_owner = $1,
             lease_expires_at = now() + make_interval(secs => $2::int / 1000),
             last_started_at = now(),
             updated_at = now()
         from candidate
         where jobs.id = candidate.id
         returning jobs.*`,
        [this.workerId, this.leaseMs],
      );
      await client.query("commit");
      return picked.rows[0] ?? null;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      console.warn("place_enrichment_claim_failed", error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      client.release();
    }
  }

  private async processJob(job: PlaceEnrichmentJobRow) {
    try {
      const result = await this.executeJob(job);
      await this.database.query(
        `update place_enrichment_jobs
         set status = $2,
             lease_owner = null,
             lease_expires_at = null,
             last_error = null,
             completed_at = now(),
             result_summary_json = $3::jsonb,
             updated_at = now()
         where id = $1`,
        [job.id, result.status, JSON.stringify(result.summary)],
      );
    } catch (error) {
      const nextRetryMs = buildBackoffMs(job.attempts + 1);
      await this.database.query(
        `update place_enrichment_jobs
         set status = 'failed',
             lease_owner = null,
             lease_expires_at = null,
             last_error = $2,
             next_retry_at = now() + make_interval(secs => $3::int / 1000),
             result_summary_json = jsonb_set(coalesce(result_summary_json, '{}'::jsonb), '{lastFailureAt}', to_jsonb(now()::text), true),
             updated_at = now()
         where id = $1`,
        [job.id, error instanceof Error ? error.message : String(error), nextRetryMs],
      ).catch(() => undefined);
    }
  }

  private async executeJob(job: PlaceEnrichmentJobRow): Promise<PlaceEnrichmentExecutionResult> {
    const payload = job.payload_json;
    const place = toSavedPlaceRecord(payload.savedPlace);
    const sourceUrl = payload.sourceUrl;
    const sourcePlatform = payload.sourcePlatform;
    const canonicalPlaceId = job.canonical_place_id;
    if (!canonicalPlaceId) {
      throw new Error("canonical_place_id_missing");
    }

    if (!sourceUrl) {
      return {
        status: "partial",
        summary: {
          reason: "missing_source_url",
          evidenceWritten: true,
          savedPlaceId: place.id,
        },
      };
    }

    const attempts: EnrichmentAttemptSummary[] = [];
    let extraction: Awaited<ReturnType<typeof runExtractionPipeline>> | null = null;
    let intelligence: Awaited<ReturnType<typeof runIntelligencePipeline>> | null = null;
    const identificationEvidence = sanitizeIdentificationEvidenceSnapshot(payload.identificationEvidence);
    const identificationExtraction = identificationEvidence
      ? extractionFromIdentificationEvidence({ snapshot: identificationEvidence, sourceUrl, sourcePlatform })
      : null;
    const accumulatedFacts = new Map<string, ReturnType<typeof extractPlaceKnowledgeFacts>[number]>();
    const groundingRejections: PlaceKnowledgeGroundingRejection[] = [];
    const identificationResult = identificationExtraction
      ? extractPlaceKnowledgeResult({ extraction: identificationExtraction, intelligence: null })
      : { facts: [], rejections: [] };
    const identificationFacts = identificationResult.facts;
    groundingRejections.push(...identificationResult.rejections);
    for (const fact of identificationFacts) {
      const enrichedFact = {
        ...fact,
        provenance: {
          sourceType: inferSourceType(fact.sourceSignal, sourcePlatform),
          sourceUrl,
          sourceRecordId: `${job.id}:identification:${fact.sourceSignal}`,
          extractorName: "deterministic_place_knowledge",
          extractorVersion: PLACE_ENRICHMENT_EXTRACTION_VERSION,
          model: null,
          originPhase: "place_identification" as const,
        },
        attributes: {
          ...(fact.attributes || {}),
          originPhase: "place_identification",
        },
      };
      const key = JSON.stringify([enrichedFact.structured?.kind ?? null, enrichedFact.structured?.value ?? null, enrichedFact.category, enrichedFact.text]);
      accumulatedFacts.set(key, enrichedFact);
    }

    // Commit Phase 1 evidence before slow providers so a later timeout cannot erase accepted evidence.
    if (identificationEvidence) {
      const phaseOneClient = await this.database.connect() as TransactionClient;
      try {
        await phaseOneClient.query("begin");
        await writeIdentificationSnapshotEvidence(phaseOneClient, {
          canonicalPlaceId,
          jobId: job.id,
          sourceUrl,
          sourcePlatform,
          snapshot: identificationEvidence,
          facts: [...accumulatedFacts.values()],
        });
        const phaseOneNow = new Date().toISOString();
        await insertEvidenceRow(phaseOneClient, {
          canonicalPlaceId,
          factType: "grounding_validation_audit",
          factValue: {
            phase: "place_identification",
            validatedStructuredFactCount: [...accumulatedFacts.values()]
              .filter((fact) => fact.structured && fact.grounding?.validation.status === "validated").length,
            rejectedUnsupportedFactCount: groundingRejections.length,
            rejections: groundingRejections,
            knowledgeSchemaVersion: PLACE_KNOWLEDGE_SCHEMA_VERSION,
          },
          sourceType: "grounding_validation_audit",
          sourceUrl,
          sourceRecordId: `${job.id}:identification:grounding-validation-audit`,
          confidence: 1,
          observedAt: identificationEvidence.observedAt || phaseOneNow,
          verifiedAt: phaseOneNow,
          expiresAt: addDaysIso(90),
          extractionVersion: PLACE_ENRICHMENT_EXTRACTION_VERSION,
          originalPayload: { jobId: job.id, originPhase: "place_identification" },
        });
        await phaseOneClient.query("commit");
      } catch (error) {
        await phaseOneClient.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        phaseOneClient.release();
      }
    }
    const existingKnowledgeEvidence = await loadCanonicalKnowledgeEvidence(this.database, canonicalPlaceId);
    const identificationKnowledgeEvidence = evidenceFromStructuredFacts([...accumulatedFacts.values()]).map((fact) => ({
      ...fact,
      sourceUrl,
      observedAt: identificationEvidence?.observedAt ?? new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
      expiresAt: addDaysIso(365),
    }));
    const initialCoverage = assessKnowledgeCoverage([...existingKnowledgeEvidence, ...identificationKnowledgeEvidence]);
    const initialRoutingDecision = planAdaptiveEnrichment({ coverage: initialCoverage });
    let routingDecision: AdaptiveRoutingDecision = initialRoutingDecision;
    let coverageBefore = initialCoverage;
    let finalCoverage = initialCoverage;
    let finalStopReason = initialRoutingDecision.stopReason;

    if (!initialRoutingDecision.selectedActions.length) {
      const now = new Date().toISOString();
      const client = await this.database.connect() as TransactionClient;
      try {
        await client.query("begin");
        await writePlaceEvidence(client, canonicalPlaceId, place);
        if (identificationEvidence) {
          await writeIdentificationSnapshotEvidence(client, {
            canonicalPlaceId,
            jobId: job.id,
            sourceUrl,
            sourcePlatform,
            snapshot: identificationEvidence,
            facts: [...accumulatedFacts.values()],
          });
        }
        await insertEvidenceRow(client, {
          canonicalPlaceId,
          factType: "enrichment_routing_audit",
          factValue: {
            initialCoverage,
            identifiedGaps: initialRoutingDecision.gaps,
            actionsConsidered: initialRoutingDecision.actionsConsidered,
            actionsSelected: [],
            actionsSkipped: initialRoutingDecision.skippedActions,
            factsAddedOrUpdated: [...accumulatedFacts.values()]
              .filter((fact) => fact.structured)
              .map((fact) => ({
                kind: fact.structured!.kind,
                value: fact.structured!.value,
                confidence: fact.confidenceScore ?? confidenceLabelToScore(fact.confidence),
                sourceSignal: fact.sourceSignal,
                supportType: fact.grounding?.supportType ?? "unsupported",
                groundingConfidence: fact.grounding?.groundingConfidence ?? 0,
                groundingValidation: fact.grounding?.validation.status ?? "unsupported",
              })),
            remainingGaps: [],
            finalStopReason: initialRoutingDecision.stopReason,
            costAvoidance: {
              modelCallsAvoided: initialRoutingDecision.estimatedModelCallsAvoided,
              stagesAvoided: initialRoutingDecision.estimatedStagesAvoided,
              fullLadderAvoided: true,
            },
          },
          sourceType: "enrichment_routing_audit",
          sourceUrl,
          sourceRecordId: `${job.id}:routing-audit`,
          confidence: 1,
          observedAt: now,
          verifiedAt: now,
          expiresAt: addDaysIso(90),
          extractionVersion: PLACE_ENRICHMENT_EXTRACTION_VERSION,
          originalPayload: { jobId: job.id },
        });
        await insertEvidenceRow(client, {
          canonicalPlaceId,
          factType: "grounding_validation_audit",
          factValue: {
            validatedStructuredFactCount: [...accumulatedFacts.values()]
              .filter((fact) => fact.structured && fact.grounding?.validation.status === "validated").length,
            rejectedUnsupportedFactCount: groundingRejections.length,
            rejections: groundingRejections,
            knowledgeSchemaVersion: PLACE_KNOWLEDGE_SCHEMA_VERSION,
          },
          sourceType: "grounding_validation_audit",
          sourceUrl,
          sourceRecordId: `${job.id}:grounding-validation-audit`,
          confidence: 1,
          observedAt: now,
          verifiedAt: now,
          expiresAt: addDaysIso(90),
          extractionVersion: PLACE_ENRICHMENT_EXTRACTION_VERSION,
          originalPayload: { jobId: job.id },
        });
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      return {
        status: "completed",
        summary: {
          canonicalPlaceId,
          savedPlaceId: place.id,
          sourceUrl,
          sourcePlatform,
          attemptsRun: 0,
          knowledgeFactCount: existingKnowledgeEvidence.length + accumulatedFacts.size,
          adaptiveRouting: {
            ...initialRoutingDecision,
            finalCoverage,
            remainingGaps: [],
            finalStopReason: initialRoutingDecision.stopReason,
          },
          extractionWorkAvoided: {
            modelCalls: initialRoutingDecision.estimatedModelCallsAvoided,
            stages: initialRoutingDecision.estimatedStagesAvoided,
            fullLadder: true,
          },
          extractionVersion: PLACE_ENRICHMENT_EXTRACTION_VERSION,
          contentFingerprint: payload.contentFingerprint ?? null,
          knowledgeSchemaVersion: PLACE_KNOWLEDGE_SCHEMA_VERSION,
          reuseSourceSignature: getReusableSourceSignature({
            sourceUrl,
            sourcePlatform,
            contentFingerprint: payload.contentFingerprint ?? null,
          }),
          status: "completed",
        },
      };
    }

    const identificationCompletedSlowSignal = Boolean(
      identificationEvidence?.transcript?.text ||
      identificationEvidence?.ocr?.text ||
      identificationEvidence?.visual?.selectedCandidate,
    );
    const pendingAttempts = [identificationCompletedSlowSignal ? 2 : 1];
    while (pendingAttempts.length) {
      const attemptNumber = pendingAttempts.shift()!;
      const triggerType = attemptNumber === 1 ? "initial" as const : "retry" as const;
      const actionsSelected = attemptNumber === 1
        ? routingDecision.selectedActions
        : attemptNumber === 2
          ? ["transcript", "ocr"]
          : ["ocr", "visual"];
      const freshExtraction = await this.extractionRunner({
        url: sourceUrl,
        mode: "deep",
        attemptNumber,
        triggerType,
        forceBackgroundEnrichment: attemptNumber === 1 && routingDecision.broadExploration,
        metadataOnlyEnrichment:
          attemptNumber === 1 &&
          routingDecision.selectedActions.every((action) => action === "caption"),
      });
      extraction = mergeIdentificationEvidence(freshExtraction, identificationEvidence, sourcePlatform);
      intelligence = await this.intelligenceRunner({
        source: extraction,
        analytics: {
          attemptNumber,
          triggerType,
        },
      });

      const attemptSummary = summarizeAttempt({
        attemptNumber,
        triggerType,
        extraction,
        intelligence,
        place,
        sourcePlatform,
        sourceUrl,
      });
      const attemptResult = extractPlaceKnowledgeResult({ extraction, intelligence });
      const attemptFacts = attemptResult.facts;
      for (const rejection of attemptResult.rejections) {
        const duplicate = groundingRejections.some((existing) =>
          existing.reason === rejection.reason &&
          existing.claimedEvidenceText === rejection.claimedEvidenceText &&
          existing.model === rejection.model);
        if (!duplicate) groundingRejections.push(rejection);
      }
      for (const fact of attemptFacts) {
        const key = JSON.stringify([fact.structured?.kind ?? null, fact.structured?.value ?? null, fact.category, fact.text]);
        if (!accumulatedFacts.has(key)) accumulatedFacts.set(key, fact);
      }
      const provisionalEvidence = evidenceFromStructuredFacts([...accumulatedFacts.values()]).map((fact) => ({
        ...fact,
        sourceUrl,
        observedAt: extraction?.metadata.fetchedAtIso ?? new Date().toISOString(),
        verifiedAt: new Date().toISOString(),
        expiresAt: addDaysIso(365),
      }));
      finalCoverage = assessKnowledgeCoverage([...existingKnowledgeEvidence, ...provisionalEvidence]);
      const gapsAfter = unresolvedCoverageKinds(finalCoverage);
      const nextRoutingDecision = planAdaptiveEnrichment({ coverage: finalCoverage });
      attemptSummary.adaptive = {
        coverageBefore,
        coverageAfter: finalCoverage,
        gapsBefore: unresolvedCoverageKinds(coverageBefore),
        gapsAfter,
        actionsSelected,
        actionsSkipped: nextRoutingDecision.skippedActions,
        decisionReason: routingDecision.broadExploration ? "empty_or_weak_place_broad_exploration" : "knowledge_gap_selected_actions",
      };
      attempts.push(attemptSummary);

      if (!gapsAfter.length) {
        attemptSummary.escalationReason = null;
        attemptSummary.terminalReason = "knowledge_coverage_sufficient";
        finalStopReason = "relevant_knowledge_coverage_sufficient";
        break;
      }
      if (attemptNumber >= 3) {
        attemptSummary.escalationReason = null;
        attemptSummary.terminalReason = "maximum_extraction_budget_reached";
        finalStopReason = "maximum_extraction_budget_reached";
        break;
      }

      const nextAttempt = attemptNumber === 1
        ? gapsAfter.some((gap) => ENRICHMENT_ACTION_CAPABILITIES
            .filter((capability) => capability.action === "transcript" || capability.action === "ocr")
            .some((capability) => capability.improves.includes(gap)))
          ? 2
          : 3
        : 3;
      const nextCapabilities = nextAttempt === 2 ? ["transcript", "ocr"] : ["ocr", "visual"];
      const canImprove = gapsAfter.some((gap) => ENRICHMENT_ACTION_CAPABILITIES
        .filter((capability) => nextCapabilities.includes(capability.action))
        .some((capability) => capability.improves.includes(gap)));
      if (!canImprove) {
        attemptSummary.escalationReason = null;
        attemptSummary.terminalReason = "current_source_has_no_useful_capability_for_remaining_gaps";
        finalStopReason = "current_source_has_no_useful_capability_for_remaining_gaps";
        break;
      }
      attemptSummary.escalationReason = `knowledge_gaps_remain:${gapsAfter.join(",")}`;
      attemptSummary.terminalReason = null;
      coverageBefore = finalCoverage;
      routingDecision = nextRoutingDecision;
      pendingAttempts.push(nextAttempt);
    }

    if (!extraction || !intelligence) {
      throw new Error("enrichment_attempt_execution_missing");
    }

    const finalAttempt = attempts[attempts.length - 1];
    const facts = [...accumulatedFacts.values()];
    const sourceCoverage = mergeCoverageEntries(attempts.map((attempt) => attempt.sourceCoverage));
    const sourceAudit = mergeAuditEntries(attempts.map((attempt) => attempt.sourceAudit));
    const observedAt = finalAttempt.observedAt;
    const verifiedAt = finalAttempt.verifiedAt;
    const extractionVersion = PLACE_ENRICHMENT_EXTRACTION_VERSION;
    const intelligenceVersion = intelligence.providerMeta?.model ?? null;
    const metadata = metadataRecord(place.metadata);
    const identificationOrigin = {
      caption: Boolean(identificationEvidence?.metadata.description),
      transcript: Boolean(identificationEvidence?.transcript?.text),
      ocr: Boolean(identificationEvidence?.ocr?.text),
      visual: Boolean(identificationEvidence?.visual?.selectedCandidate),
      placeResolution: Boolean(identificationEvidence?.placeResolution),
    };
    const contentFingerprint = buildCheapSourceContentFingerprint({
      title: extraction.metadata.title,
      description: extraction.metadata.description,
      imageUrl: extraction.metadata.imageUrl,
      siteName: extraction.metadata.siteName,
      provider: extraction.metadata.provider,
      canonicalUrl: extraction.metadata.canonicalUrl,
      sourcePlatform: sourcePlatform ?? extraction.metadata.platform,
    });
    const terminalStatus = determineEnrichmentTerminalStatus({
      factsCount: facts.length,
      sourceAudit,
    });

    const client = await this.database.connect() as TransactionClient;
    try {
      await client.query("begin");
      await writePlaceEvidence(client, canonicalPlaceId, place);

      if (identificationEvidence?.placeResolution) {
        await insertEvidenceRow(client, {
          canonicalPlaceId,
          factType: "identification_place_resolution",
          factValue: {
            ...identificationEvidence.placeResolution,
            provenance: {
              sourceType: "place_identification",
              sourceUrl,
              sourceRecordId: `${job.id}:identification:resolution`,
              extractorVersion: extractionVersion,
              model: null,
              originPhase: "place_identification",
            },
            freshness: {
              observedAt: identificationEvidence.observedAt || observedAt,
              verifiedAt,
              staleAfterDays: freshnessDaysForFactType("place_resolution"),
            },
          },
          sourceType: "place_identification",
          sourceUrl,
          sourceRecordId: `${job.id}:identification:resolution`,
          confidence: identificationEvidence.placeResolution.confidence === "high" ? 0.9 : 0.7,
          observedAt: identificationEvidence.observedAt || observedAt,
          verifiedAt,
          expiresAt: addDaysIso(freshnessDaysForFactType("place_resolution")),
          extractionVersion,
          intelligenceVersion,
          originalPayload: { jobId: job.id, originPhase: "place_identification" },
        });
      }

      await insertEvidenceRow(client, {
        canonicalPlaceId,
        factType: "source_metadata",
        factValue: {
          title: extraction.metadata.title,
          siteName: extraction.metadata.siteName,
          imageUrl: extraction.metadata.imageUrl,
          provider: extraction.metadata.provider,
          sourcePlatform: sourcePlatform ?? extraction.metadata.platform,
          provenance: {
            sourceType: inferSourceType("saved_place", sourcePlatform),
            sourceUrl,
            sourceRecordId: job.id,
            extractorVersion: extractionVersion,
            model: null,
            originPhase: identificationOrigin.caption ? "place_identification" : "background_enrichment",
          },
          freshness: {
            observedAt,
            verifiedAt,
            staleAfterDays: freshnessDaysForFactType("source_metadata"),
          },
        },
        sourceType: "source_metadata",
        sourceUrl,
        sourceRecordId: `${job.id}:metadata`,
        confidence: 0.8,
        observedAt,
        verifiedAt,
        expiresAt: addDaysIso(freshnessDaysForFactType("source_metadata")),
        extractionVersion,
        intelligenceVersion,
        originalPayload: { jobId: job.id, sourceCoverage },
      });

      await insertEvidenceRow(client, {
        canonicalPlaceId,
        factType: "location_metadata",
        factValue: {
          locality: normalizeText(metadata.locality) || extraction.visualFallback?.selectedCandidate?.locality || null,
          city: normalizeText(metadata.city) || extraction.visualFallback?.selectedCandidate?.city || null,
          state: normalizeText(metadata.state) || extraction.visualFallback?.selectedCandidate?.state || null,
          country: normalizeText(metadata.country) || extraction.visualFallback?.selectedCandidate?.country || null,
          fullAddress: normalizeText(metadata.fullAddress) || extraction.visualFallback?.selectedCandidate?.formattedAddress || null,
          lat: metadata.lat ?? metadata.latitude ?? null,
          lng: metadata.lng ?? metadata.longitude ?? null,
          provenance: {
            sourceType: "location_metadata",
            sourceUrl,
            sourceRecordId: `${job.id}:location`,
            extractorVersion: extractionVersion,
            model: null,
          },
          freshness: {
            observedAt,
            verifiedAt,
            staleAfterDays: freshnessDaysForFactType("location_metadata"),
          },
        },
        sourceType: "location_metadata",
        sourceUrl,
        sourceRecordId: `${job.id}:location`,
        confidence: 0.85,
        observedAt,
        verifiedAt,
        expiresAt: addDaysIso(freshnessDaysForFactType("location_metadata")),
        extractionVersion,
        intelligenceVersion,
        originalPayload: { jobId: job.id },
      });

      if (String(extraction.metadata.description || "").trim()) {
        await insertEvidenceRow(client, {
          canonicalPlaceId,
          factType: "source_caption",
          factValue: {
            text: extraction.metadata.description,
            provider: extraction.metadata.provider,
            provenance: {
              sourceType: inferSourceType("caption", sourcePlatform),
              sourceUrl,
              sourceRecordId: identificationOrigin.caption ? `${job.id}:identification:caption` : `${job.id}:caption`,
              extractorVersion: extractionVersion,
              model: null,
              originPhase: identificationOrigin.caption ? "place_identification" : "background_enrichment",
            },
            freshness: {
              observedAt,
              verifiedAt,
              staleAfterDays: freshnessDaysForFactType("source_caption"),
            },
          },
          sourceType: inferSourceType("caption", sourcePlatform),
          sourceUrl,
          sourceRecordId: identificationOrigin.caption ? `${job.id}:identification:caption` : `${job.id}:caption`,
          confidence: 0.7,
          observedAt,
          verifiedAt,
          expiresAt: addDaysIso(freshnessDaysForFactType("source_caption")),
          extractionVersion,
          intelligenceVersion,
          originalPayload: { jobId: job.id },
        });
      }

      if (extraction.transcript?.text) {
        await insertEvidenceRow(client, {
          canonicalPlaceId,
          factType: "transcript",
          factValue: {
            text: extraction.transcript.text,
            source: extraction.transcript.source,
            reason: extraction.transcript.reason,
            provenance: {
              sourceType: inferSourceType("transcript", sourcePlatform),
              sourceUrl,
              sourceRecordId: identificationOrigin.transcript ? `${job.id}:identification:transcript` : `${job.id}:transcript`,
              extractorVersion: extractionVersion,
              model: extraction.transcript.source ?? null,
              originPhase: identificationOrigin.transcript ? "place_identification" : "background_enrichment",
            },
            freshness: {
              observedAt,
              verifiedAt,
              staleAfterDays: freshnessDaysForFactType("transcript"),
            },
          },
          sourceType: inferSourceType("transcript", sourcePlatform),
          sourceUrl,
          sourceRecordId: identificationOrigin.transcript ? `${job.id}:identification:transcript` : `${job.id}:transcript`,
          confidence: extraction.transcript.used ? 0.9 : 0.6,
          observedAt,
          verifiedAt,
          expiresAt: addDaysIso(freshnessDaysForFactType("transcript")),
          extractionVersion,
          originalPayload: { jobId: job.id },
        });
      }

      if (extraction.ocr?.text) {
        await insertEvidenceRow(client, {
          canonicalPlaceId,
          factType: "ocr_text",
          factValue: {
            text: extraction.ocr.text,
            provider: extraction.ocr.provider ?? null,
            reason: extraction.ocr.reason,
            provenance: {
              sourceType: inferSourceType("ocr", sourcePlatform),
              sourceUrl,
              sourceRecordId: identificationOrigin.ocr ? `${job.id}:identification:ocr` : `${job.id}:ocr`,
              extractorVersion: extractionVersion,
              model: extraction.ocr.provider ?? null,
              originPhase: identificationOrigin.ocr ? "place_identification" : "background_enrichment",
            },
            freshness: {
              observedAt,
              verifiedAt,
              staleAfterDays: freshnessDaysForFactType("ocr_text"),
            },
          },
          sourceType: inferSourceType("ocr", sourcePlatform),
          sourceUrl,
          sourceRecordId: identificationOrigin.ocr ? `${job.id}:identification:ocr` : `${job.id}:ocr`,
          confidence: extraction.ocr.used ? 0.75 : 0.5,
          observedAt,
          verifiedAt,
          expiresAt: addDaysIso(freshnessDaysForFactType("ocr_text")),
          extractionVersion,
          originalPayload: { jobId: job.id },
        });
      }

      if (extraction.visualFallback?.selectedCandidate) {
        await insertEvidenceRow(client, {
          canonicalPlaceId,
          factType: "visual_candidate",
          factValue: {
            candidateName: extraction.visualFallback.selectedCandidate.candidateName,
            formattedAddress: extraction.visualFallback.selectedCandidate.formattedAddress,
            locality: extraction.visualFallback.selectedCandidate.locality,
            city: extraction.visualFallback.selectedCandidate.city,
            state: extraction.visualFallback.selectedCandidate.state,
            country: extraction.visualFallback.selectedCandidate.country,
            placeId: extraction.visualFallback.selectedCandidate.placeId,
            query: extraction.visualFallback.selectedCandidate.query,
            visualEvidence: extraction.visualFallback.selectedCandidate.visualEvidence ?? null,
            verificationConfidence: extraction.visualFallback.selectedCandidate.verificationConfidence,
            provenance: {
              sourceType: inferSourceType("visual", sourcePlatform),
              sourceUrl,
              sourceRecordId: identificationOrigin.visual ? `${job.id}:identification:visual` : `${job.id}:visual`,
              extractorVersion: extractionVersion,
              model: null,
              originPhase: identificationOrigin.visual ? "place_identification" : "background_enrichment",
            },
            freshness: {
              observedAt,
              verifiedAt,
              staleAfterDays: freshnessDaysForFactType("visual_candidate"),
            },
          },
          sourceType: inferSourceType("visual", sourcePlatform),
          sourceUrl,
          sourceRecordId: identificationOrigin.visual ? `${job.id}:identification:visual` : `${job.id}:visual`,
          confidence: extraction.visualFallback.selectedCandidate.verificationConfidence === "high" ? 0.92 : 0.74,
          observedAt,
          verifiedAt,
          expiresAt: addDaysIso(freshnessDaysForFactType("visual_candidate")),
          extractionVersion,
          intelligenceVersion,
          originalPayload: { jobId: job.id },
        });
      }

      const commentEvidence = extraction.metadata.commentEvidence;
      for (const comment of [commentEvidence?.pinnedComment, ...(commentEvidence?.topComments || []), ...(commentEvidence?.creatorReplies || [])].filter(Boolean)) {
        await insertEvidenceRow(client, {
          canonicalPlaceId,
          factType: "comment_signal",
          factValue: {
            text: comment,
            provenance: {
              sourceType: inferSourceType("comment", sourcePlatform),
              sourceUrl,
              sourceRecordId: `${job.id}:comment:${fingerprint(comment).slice(0, 12)}`,
              extractorVersion: extractionVersion,
              model: null,
            },
            freshness: {
              observedAt,
              verifiedAt,
              staleAfterDays: freshnessDaysForFactType("comment_signal"),
            },
          },
          sourceType: inferSourceType("comment", sourcePlatform),
          sourceUrl,
          sourceRecordId: `${job.id}:comment:${fingerprint(comment).slice(0, 12)}`,
          confidence: 0.55,
          observedAt,
          verifiedAt,
          expiresAt: addDaysIso(freshnessDaysForFactType("comment_signal")),
          extractionVersion,
          originalPayload: { jobId: job.id },
        });
      }

      for (const entity of intelligence.output.structuredEntities || []) {
        await insertEvidenceRow(client, {
          canonicalPlaceId,
          factType: "structured_entity_signal",
          factValue: {
            name: entity.name,
            category: entity.category,
            locality: entity.locality,
            city: entity.city,
            address: entity.address,
            placeId: entity.placeId ?? null,
            confidence: entity.confidence,
            intent: entity.intent ?? null,
            provenance: {
              sourceType: inferSourceType("intelligence", sourcePlatform),
              sourceUrl,
              sourceRecordId: `${job.id}:entity:${entity.placeId || entity.name}`,
              extractorVersion: extractionVersion,
              model: intelligenceVersion,
            },
            freshness: {
              observedAt,
              verifiedAt,
              staleAfterDays: freshnessDaysForFactType("structured_entity_signal"),
            },
          },
          sourceType: inferSourceType("intelligence", sourcePlatform),
          sourceUrl,
          sourceRecordId: `${job.id}:entity:${entity.placeId || entity.name}`,
          confidence: entity.confidence === "high" ? 0.9 : entity.confidence === "medium" ? 0.7 : 0.45,
          observedAt,
          verifiedAt,
          expiresAt: addDaysIso(freshnessDaysForFactType("structured_entity_signal")),
          extractionVersion,
          intelligenceVersion,
          originalPayload: { jobId: job.id },
        });
      }

      if (sourceCoverage.googleMaps) {
        await insertEvidenceRow(client, {
          canonicalPlaceId,
          factType: "place_resolution",
          factValue: {
            googlePlaceId:
              normalizeText(metadata.googlePlaceId) ||
              normalizeText(metadata.google_place_id) ||
              normalizeText(metadata.googleMapsPlaceId) ||
              intelligence.output.structuredEntities.find((entity) => entity.placeId)?.placeId ||
              null,
            resolvedBy: intelligence.output.structuredEntities.find((entity) => entity.resolvedBy)?.resolvedBy || null,
            resolutionConfidence: intelligence.output.structuredEntities.find((entity) => entity.resolutionConfidence)?.resolutionConfidence || null,
            provenance: {
              sourceType: "google_maps_resolution",
              sourceUrl,
              sourceRecordId: `${job.id}:resolution`,
              extractorVersion: extractionVersion,
              model: intelligenceVersion,
            },
            freshness: {
              observedAt,
              verifiedAt,
              staleAfterDays: freshnessDaysForFactType("place_resolution"),
            },
          },
          sourceType: "google_maps_resolution",
          sourceUrl,
          sourceRecordId: `${job.id}:resolution`,
          confidence: 0.88,
          observedAt,
          verifiedAt,
          expiresAt: addDaysIso(freshnessDaysForFactType("place_resolution")),
          extractionVersion,
          intelligenceVersion,
          originalPayload: { jobId: job.id },
        });
      }

      for (const fact of facts) {
        if (fact.attributes?.originPhase === "place_identification") continue;
        await insertEvidenceRow(client, {
          canonicalPlaceId,
          factType: `knowledge_${fact.category}`,
          factValue: {
            text: fact.text,
            category: fact.category,
            sourceSignal: fact.sourceSignal,
            confidence: fact.confidence,
            confidenceScore: fact.confidenceScore ?? confidenceLabelToScore(fact.confidence),
            structured: fact.structured ?? null,
            grounding: fact.grounding ?? null,
            provenance: fact.provenance ?? {
              sourceType: inferSourceType(fact.sourceSignal, sourcePlatform),
              sourceUrl,
              sourceRecordId: `${job.id}:knowledge:${fact.category}:${fingerprint(fact.text).slice(0, 12)}`,
              extractorName: "deterministic_place_knowledge",
              extractorVersion: extractionVersion,
              model: fact.sourceSignal === "intelligence" ? intelligenceVersion : null,
            },
            freshness: fact.freshness ?? {
              observedAt,
              verifiedAt,
              staleAfterDays: freshnessDaysForFactType(`knowledge_${fact.category}`),
            },
            attributes: fact.attributes ?? {},
          },
          sourceType: inferSourceType(fact.sourceSignal, sourcePlatform),
          sourceUrl,
          sourceRecordId: `${job.id}:knowledge:${fact.category}:${fingerprint(fact.text).slice(0, 12)}`,
          confidence: fact.confidenceScore ?? confidenceLabelToScore(fact.confidence),
          observedAt,
          verifiedAt,
          expiresAt: addDaysIso(freshnessDaysForFactType(`knowledge_${fact.category}`)),
          extractionVersion,
          intelligenceVersion,
          originalPayload: { jobId: job.id },
        });
      }

      const routingAudit = {
        initialCoverage,
        identifiedGaps: initialRoutingDecision.gaps,
        actionsConsidered: initialRoutingDecision.actionsConsidered,
        actionsSelected: attempts.flatMap((attempt) => attempt.adaptive?.actionsSelected || []),
        actionsSkipped: initialRoutingDecision.skippedActions,
        attempts: attempts.map((attempt) => attempt.adaptive),
        factsAddedOrUpdated: facts
          .filter((fact) => fact.structured)
          .map((fact) => ({
            kind: fact.structured!.kind,
            value: fact.structured!.value,
            confidence: fact.confidenceScore ?? confidenceLabelToScore(fact.confidence),
            sourceSignal: fact.sourceSignal,
            supportType: fact.grounding?.supportType ?? "unsupported",
            groundingConfidence: fact.grounding?.groundingConfidence ?? 0,
            groundingValidation: fact.grounding?.validation.status ?? "unsupported",
          })),
        finalCoverage,
        remainingGaps: unresolvedCoverageKinds(finalCoverage),
        finalStopReason: finalStopReason || finalAttempt.terminalReason || "all_available_evidence_exhausted",
        costAvoidance: {
          modelCallsAvoided: initialRoutingDecision.estimatedModelCallsAvoided,
          stagesAvoided: initialRoutingDecision.estimatedStagesAvoided,
          ladderAttemptsAvoided: Math.max(0, 3 - attempts.length),
        },
      };

      await insertEvidenceRow(client, {
        canonicalPlaceId,
        factType: "grounding_validation_audit",
        factValue: {
          validatedStructuredFactCount: facts.filter((fact) => fact.structured && fact.grounding?.validation.status === "validated").length,
          rejectedUnsupportedFactCount: groundingRejections.length,
          rejections: groundingRejections,
          knowledgeSchemaVersion: PLACE_KNOWLEDGE_SCHEMA_VERSION,
        },
        sourceType: "grounding_validation_audit",
        sourceUrl,
        sourceRecordId: `${job.id}:grounding-validation-audit`,
        confidence: 1,
        observedAt,
        verifiedAt,
        expiresAt: addDaysIso(90),
        extractionVersion,
        intelligenceVersion,
        originalPayload: { jobId: job.id },
      });

      await insertEvidenceRow(client, {
        canonicalPlaceId,
        factType: "enrichment_routing_audit",
        factValue: routingAudit,
        sourceType: "enrichment_routing_audit",
        sourceUrl,
        sourceRecordId: `${job.id}:routing-audit`,
        confidence: 1,
        observedAt,
        verifiedAt,
        expiresAt: addDaysIso(90),
        extractionVersion,
        intelligenceVersion,
        originalPayload: { jobId: job.id },
      });

      await insertEvidenceRow(client, {
        canonicalPlaceId,
        factType: "enrichment_source_audit",
        factValue: {
          coverage: sourceCoverage,
          sources: sourceAudit,
          ladder: attempts,
          adaptiveRouting: routingAudit,
          sourcePlatform: sourcePlatform ?? extraction.metadata.platform,
          sourceUrl,
          provenance: {
            sourceType: "enrichment_source_audit",
            sourceUrl,
            sourceRecordId: `${job.id}:source-audit`,
            extractorVersion: extractionVersion,
            model: intelligenceVersion,
          },
          freshness: {
            observedAt,
            verifiedAt,
            staleAfterDays: 90,
          },
        },
        sourceType: "enrichment_source_audit",
        sourceUrl,
        sourceRecordId: `${job.id}:source-audit`,
        confidence: 1,
        observedAt,
        verifiedAt,
        expiresAt: addDaysIso(90),
        extractionVersion,
        intelligenceVersion,
        originalPayload: { jobId: job.id },
      });

      await client.query("commit");

      return {
        status: terminalStatus,
        summary: {
          canonicalPlaceId,
          savedPlaceId: place.id,
          sourceUrl,
          sourcePlatform: sourcePlatform ?? extraction.metadata.platform,
          ladder: attempts,
          attemptsRun: attempts.length,
          finalAttemptNumber: finalAttempt.attemptNumber,
          finalRoute: finalAttempt.route,
          finalAcceptedAfter: finalAttempt.acceptedAfter,
          finalIntelligenceStatus: finalAttempt.intelligenceStatus,
          escalationStoppedBecause: finalAttempt.terminalReason,
          knowledgeFactCount: facts.length,
          structuredEntityCount: intelligence.output.structuredEntities.length,
          transcriptChars: String(extraction.transcript?.text || "").length,
          ocrChars: String(extraction.ocr?.text || "").length,
          sourceCoverage,
          sourceAudit,
          adaptiveRouting: routingAudit,
          enrichmentModel: intelligenceVersion,
          extractionVersion,
          contentFingerprint,
          knowledgeSchemaVersion: PLACE_KNOWLEDGE_SCHEMA_VERSION,
          reuseSourceSignature: getReusableSourceSignature({
            sourceUrl,
            sourcePlatform: sourcePlatform ?? extraction.metadata.platform,
            contentFingerprint,
          }),
          enrichmentObservedAt: observedAt,
          enrichmentVerifiedAt: verifiedAt,
          status: terminalStatus,
        },
        extraction,
        intelligence,
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export const placeEnrichmentJobStore = new PlaceEnrichmentJobStore();

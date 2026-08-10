import test from "node:test";
import assert from "node:assert/strict";
import { __resetPostgresTestConfig, __setPostgresTestConfig } from "../auth/postgresAuth";
import {
  determineEnrichmentTerminalStatus,
  loadGroundedPlaceKnowledge,
  mergeIdentificationEvidence,
  PlaceEnrichmentJobStore,
  sanitizeIdentificationEvidenceSnapshot,
  shouldEscalateEnrichmentAttempt,
  shouldReuseExistingEnrichment,
} from "./store";
import type { ExtractionResult } from "../extraction/types";

test.afterEach(() => {
  __resetPostgresTestConfig();
});

test("identification evidence is bounded and survives a later empty OCR result", () => {
  const snapshot = sanitizeIdentificationEvidenceSnapshot({
    version: "identification_evidence_v1",
    observedAt: "2026-08-09T00:00:00.000Z",
    attemptNumber: 1,
    acceptedAfter: "ocr",
    metadata: {
      title: "Eva Cafe",
      description: "By the sea",
      provider: "instagram_script",
    },
    ocr: {
      text: "YOU ME&COFFEE\nBY THE SEA\nEva cafe, Anjuna",
      provider: "frame_ocr",
    },
    placeResolution: {
      name: "YOU ME&COFFEE",
      locality: "Anjuna",
      confidence: "high",
      ignored: "x".repeat(20_000),
    },
  });
  assert.ok(snapshot);
  assert.equal("ignored" in (snapshot?.placeResolution || {}), false);

  const freshExtraction: ExtractionResult = {
    mode: "deep",
    metadata: {
      sourceUrl: "https://www.instagram.com/p/example/",
      canonicalUrl: "https://www.instagram.com/p/example/",
      platform: "instagram",
      title: "Eva Cafe",
      description: "",
      siteName: "Instagram",
      imageUrl: null,
      fetchedAtIso: "2026-08-10T00:00:00.000Z",
      provider: "instagram_script",
    },
    transcript: null,
    ocr: { attempted: true, used: false, text: "", reason: "vision_ocr_empty" },
    source: "https://www.instagram.com/p/example/",
    platform: "instagram",
    canonicalUrl: "https://www.instagram.com/p/example/",
  };

  const merged = mergeIdentificationEvidence(freshExtraction, snapshot, "instagram");
  assert.equal(merged.ocr?.text, "YOU ME&COFFEE\nBY THE SEA\nEva cafe, Anjuna");
  assert.equal(merged.ocr?.used, true);
  assert.deepEqual((merged.debug as any)?.identificationEvidence, {
    reused: true,
    acceptedAfter: "ocr",
    transcriptReused: false,
    ocrReused: true,
    visualReused: false,
  });
});

type QueryResult = {
  rows?: Array<Record<string, unknown>>;
  rowCount?: number;
};

function createDatabaseMock() {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];

  const query = async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });

    if (/select canonical_place_id from user_saved_places/i.test(sql)) {
      return { rows: [{ canonical_place_id: null }], rowCount: 1 };
    }
    if (/select pg_advisory_xact_lock/i.test(sql)) {
      return { rows: [], rowCount: 1 };
    }
    if (/insert into places/i.test(sql)) {
      return { rows: [{ id: "canonical-1", inserted: true }], rowCount: 1 };
    }
    if (/update user_saved_places set canonical_place_id/i.test(sql)) {
      return { rows: [], rowCount: 1 };
    }
    if (/insert into place_source_evidence/i.test(sql)) {
      return { rows: [], rowCount: 1 };
    }
    if (/from place_enrichment_jobs[\s\S]*status in \('pending', 'running'\)/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    if (/from place_enrichment_jobs[\s\S]*completed_at desc nulls last/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    if (/insert into place_enrichment_jobs/i.test(sql)) {
      return {
        rows: [{
          id: "job-1",
          dedupe_key: "dedupe-1",
          user_id: "user-1",
          saved_place_id: "saved-1",
          canonical_place_id: "canonical-1",
          status: "pending",
          attempts: 0,
          max_attempts: 4,
          lease_owner: null,
          lease_expires_at: null,
          source_url: "https://www.instagram.com/p/example/",
          source_platform: "instagram",
          trigger_reason: "save",
          last_error: null,
          next_retry_at: "2026-08-02T00:00:00.000Z",
          last_started_at: null,
          completed_at: null,
          payload_json: {},
          result_summary_json: {},
          created_at: "2026-08-02T00:00:00.000Z",
          updated_at: "2026-08-02T00:00:00.000Z",
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 1 } satisfies QueryResult;
  };

  return {
    calls,
    database: {
      query,
      connect: async () => ({
        query,
        release: () => undefined,
      }),
    },
  };
}

test("triggerFromSavedPlace resolves canonical place, writes seed evidence, and enqueues one pending job", async () => {
  const mock = createDatabaseMock();
  __setPostgresTestConfig({
    databaseOverride: mock.database as any,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });
  const store = new PlaceEnrichmentJobStore({
    database: mock.database as any,
    workerId: "test-worker",
    metadataExtractor: async () => ({
      sourceUrl: "https://www.instagram.com/p/example/",
      canonicalUrl: "https://www.instagram.com/p/example/",
      platform: "instagram",
      title: "Eva Cafe",
      description: "Brunch spot with coffee and croissants.",
      siteName: "Instagram",
      imageUrl: "https://example.com/eva.jpg",
      fetchedAtIso: "2026-08-09T00:00:00.000Z",
      provider: "instagram_script",
      commentEvidence: {
        attempted: false,
        timedOut: false,
        pinnedComment: null,
        topComments: [],
        creatorReplies: [],
        commentsFetchedCount: 0,
        commentRepliesFetchedCount: 0,
        creatorReplyCount: 0,
        provider: "instagram_script",
        reason: null,
      },
    }),
  });

  const result = await store.triggerFromSavedPlace({
    userId: "user-1",
    savedPlace: {
      id: "saved-1",
      placeId: "place-1",
      title: "Eva Cafe",
      category: "Taste",
      metadata: {
        locality: "Anjuna",
        city: "Goa",
        videoUrl: "https://www.instagram.com/p/example/",
        lat: 15.6,
        lng: 73.7,
      },
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    },
  });

  assert.equal(result?.duplicate, false);
  assert.equal(result?.job.id, "job-1");
  assert.equal(result?.job.canonicalPlaceId, "canonical-1");
  assert.ok(mock.calls.some((call) => /insert into place_enrichment_jobs/i.test(call.sql)));
  assert.ok(mock.calls.some((call) => /insert into place_source_evidence/i.test(call.sql)));
  assert.ok(mock.calls.some((call) => /update user_saved_places set canonical_place_id/i.test(call.sql)));
});

test("shouldReuseExistingEnrichment reuses completed matching source knowledge", () => {
  const result = shouldReuseExistingEnrichment({
    previousJob: {
      status: "partial",
      result_summary_json: {
        knowledgeFactCount: 6,
        structuredEntityCount: 1,
        reuseSourceSignature: JSON.stringify({
          sourceUrl: "https://www.instagram.com/p/example/",
          sourcePlatform: "instagram",
          contentFingerprint: "fp-same",
          extractionVersion: "deep_v2",
          knowledgeSchemaVersion: "place_knowledge_v4",
        }),
      },
    } as any,
    sourceUrl: "https://www.instagram.com/p/example/",
    sourcePlatform: "instagram",
    contentFingerprint: "fp-same",
  });

  assert.deepEqual(result, {
    reuse: true,
    reason: "same_source_reused_existing_knowledge",
  });
});

test("shouldReuseExistingEnrichment rejects version or source mismatches", () => {
  const mismatch = shouldReuseExistingEnrichment({
    previousJob: {
      status: "completed",
      result_summary_json: {
        knowledgeFactCount: 6,
        structuredEntityCount: 2,
        reuseSourceSignature: JSON.stringify({
          sourceUrl: "https://www.instagram.com/p/example/",
          sourcePlatform: "instagram",
          contentFingerprint: "fp-same",
          extractionVersion: "deep_v0",
          knowledgeSchemaVersion: "place_knowledge_v1",
        }),
      },
    } as any,
    sourceUrl: "https://www.instagram.com/p/example/",
    sourcePlatform: "instagram",
    contentFingerprint: "fp-same",
  });

  assert.deepEqual(mismatch, {
    reuse: false,
    reason: "enrichment_version_or_source_signature_changed",
  });

  const missingKnowledge = shouldReuseExistingEnrichment({
    previousJob: {
      status: "completed",
      result_summary_json: {
        knowledgeFactCount: 0,
        structuredEntityCount: 0,
        reuseSourceSignature: JSON.stringify({
          sourceUrl: "https://www.instagram.com/p/example/",
          sourcePlatform: "instagram",
          contentFingerprint: "fp-same",
          extractionVersion: "deep_v2",
          knowledgeSchemaVersion: "place_knowledge_v4",
        }),
      },
    } as any,
    sourceUrl: "https://www.instagram.com/p/example/",
    sourcePlatform: "instagram",
    contentFingerprint: "fp-same",
  });

  assert.deepEqual(missingKnowledge, {
    reuse: false,
    reason: "previous_job_missing_reusable_knowledge",
  });
});

test("shouldReuseExistingEnrichment rejects changed content behind the same URL", () => {
  const changed = shouldReuseExistingEnrichment({
    previousJob: {
      status: "completed",
      result_summary_json: {
        knowledgeFactCount: 6,
        structuredEntityCount: 1,
        reuseSourceSignature: JSON.stringify({
          sourceUrl: "https://www.instagram.com/p/example/",
          sourcePlatform: "instagram",
          contentFingerprint: "fp-old",
          extractionVersion: "deep_v2",
          knowledgeSchemaVersion: "place_knowledge_v4",
        }),
      },
    } as any,
    sourceUrl: "https://www.instagram.com/p/example/",
    sourcePlatform: "instagram",
    contentFingerprint: "fp-new",
  });

  assert.deepEqual(changed, {
    reuse: false,
    reason: "source_content_changed",
  });
});

test("shouldEscalateEnrichmentAttempt escalates unresolved attempt 1 and 2 but stops at attempt 3", () => {
  assert.equal(shouldEscalateEnrichmentAttempt({
    attemptNumber: 1,
    acceptedAfter: "manual_review",
    intelligenceStatus: "needs_review",
  }), "manual_review_requires_deeper_evidence");

  assert.equal(shouldEscalateEnrichmentAttempt({
    attemptNumber: 2,
    acceptedAfter: "ocr",
    intelligenceStatus: "no_supported_entity_found",
  }), "no_supported_entity_found");

  assert.equal(shouldEscalateEnrichmentAttempt({
    attemptNumber: 3,
    acceptedAfter: "manual_review",
    intelligenceStatus: "needs_review",
  }), null);

  assert.equal(shouldEscalateEnrichmentAttempt({
    attemptNumber: 1,
    acceptedAfter: "transcript",
    intelligenceStatus: "ready",
  }), null);
});

test("determineEnrichmentTerminalStatus returns partial when attempted sources remain unresolved", () => {
  const partial = determineEnrichmentTerminalStatus({
    factsCount: 2,
    sourceAudit: {
      caption: { available: true, attempted: true, contributed: true, failed: false, noUsableEvidence: false, reason: null, provider: "instagram_script" },
      transcript: { available: true, attempted: true, contributed: false, failed: true, noUsableEvidence: false, reason: "provider_error", provider: "captions" },
      ocr: { available: true, attempted: true, contributed: true, failed: false, noUsableEvidence: false, reason: null, provider: "vision_ocr" },
      visual: { available: true, attempted: true, contributed: false, failed: false, noUsableEvidence: true, reason: "no_verified_candidates", provider: "shared_visual_fallback" },
      comments: { available: false, attempted: false, contributed: false, failed: false, noUsableEvidence: false, reason: null, provider: null },
      creatorMetadata: { available: true, attempted: true, contributed: true, failed: false, noUsableEvidence: false, reason: null, provider: "instagram_script" },
      locationMetadata: { available: true, attempted: true, contributed: true, failed: false, noUsableEvidence: false, reason: null, provider: "saved_place_metadata" },
      structuredIntelligence: { available: true, attempted: true, contributed: true, failed: false, noUsableEvidence: false, reason: null, provider: "gpt-5" },
      googleMaps: { available: true, attempted: true, contributed: true, failed: false, noUsableEvidence: false, reason: null, provider: "google_maps" },
      website: { available: true, attempted: true, contributed: true, failed: false, noUsableEvidence: false, reason: null, provider: "instagram" },
    },
  });
  assert.equal(partial, "partial");

  const completed = determineEnrichmentTerminalStatus({
    factsCount: 3,
    sourceAudit: {
      caption: { available: true, attempted: true, contributed: true, failed: false, noUsableEvidence: false, reason: null, provider: "instagram_script" },
      transcript: { available: true, attempted: true, contributed: true, failed: false, noUsableEvidence: false, reason: null, provider: "captions" },
      ocr: { available: true, attempted: true, contributed: true, failed: false, noUsableEvidence: false, reason: null, provider: "vision_ocr" },
      visual: { available: true, attempted: true, contributed: true, failed: false, noUsableEvidence: false, reason: null, provider: "shared_visual_fallback" },
      comments: { available: false, attempted: false, contributed: false, failed: false, noUsableEvidence: false, reason: null, provider: null },
      creatorMetadata: { available: true, attempted: true, contributed: true, failed: false, noUsableEvidence: false, reason: null, provider: "instagram_script" },
      locationMetadata: { available: true, attempted: true, contributed: true, failed: false, noUsableEvidence: false, reason: null, provider: "saved_place_metadata" },
      structuredIntelligence: { available: true, attempted: true, contributed: true, failed: false, noUsableEvidence: false, reason: null, provider: "gpt-5" },
      googleMaps: { available: true, attempted: true, contributed: true, failed: false, noUsableEvidence: false, reason: null, provider: "google_maps" },
      website: { available: true, attempted: true, contributed: true, failed: false, noUsableEvidence: false, reason: null, provider: "instagram" },
    },
  });
  assert.equal(completed, "completed");
});

test("loadGroundedPlaceKnowledge returns a query-ready supported fact view", async () => {
  const grounding = {
    supportType: "direct",
    sourceSignal: "transcript",
    evidenceText: "order the butter garlic prawns",
    sourceField: "transcript.segments[0].text",
    groundingConfidence: 0.98,
    span: { start: 0, end: 32, unit: "character" },
    sourceLocation: { startMs: 21_000, endMs: 25_000 },
    validation: { status: "validated", method: "exact_span", reason: null },
  };
  const database = {
    query: async (sql: string) => {
      assert.match(sql, /validation' ->> 'status' = 'validated'/);
      return { rows: [{
        id: "evidence-1",
        fact_type: "knowledge_food",
        fact_value_json: {
          structured: { kind: "recommended_item", value: "butter garlic prawns", qualifiers: {} },
          grounding,
          provenance: { sourceType: "website_transcript", originPhase: "place_identification" },
        },
        source_url: "https://example.com/source",
        source_type: "website_transcript",
        source_record_id: "job-1:identification:transcript",
        extraction_version: "deep_v2",
        intelligence_version: null,
        confidence: 0.9,
        observed_at: "2026-08-10T00:00:00.000Z",
        verified_at: "2026-08-10T00:01:00.000Z",
        expires_at: "2027-08-10T00:00:00.000Z",
      }] };
    },
  };
  const result = await loadGroundedPlaceKnowledge(database as any, "place-1");
  assert.deepEqual(result[0], {
    evidenceId: "evidence-1",
    factType: "knowledge_food",
    kind: "recommended_item",
    value: "butter garlic prawns",
    qualifiers: {},
    factConfidence: 0.9,
    grounding,
    provenance: { sourceType: "website_transcript", originPhase: "place_identification" },
    sourceUrl: "https://example.com/source",
    sourceType: "website_transcript",
    sourceRecordId: "job-1:identification:transcript",
    extractorVersion: "deep_v2",
    model: null,
    observedAt: "2026-08-10T00:00:00.000Z",
    verifiedAt: "2026-08-10T00:01:00.000Z",
    expiresAt: "2027-08-10T00:00:00.000Z",
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { __resetPostgresTestConfig, __setPostgresTestConfig } from "../auth/postgresAuth";
import {
  determineEnrichmentTerminalStatus,
  PlaceEnrichmentJobStore,
  shouldEscalateEnrichmentAttempt,
  shouldReuseExistingEnrichment,
} from "./store";

test.afterEach(() => {
  __resetPostgresTestConfig();
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
          extractionVersion: "deep_v1",
          knowledgeSchemaVersion: "place_knowledge_v2",
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
          extractionVersion: "deep_v1",
          knowledgeSchemaVersion: "place_knowledge_v2",
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
          extractionVersion: "deep_v1",
          knowledgeSchemaVersion: "place_knowledge_v2",
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

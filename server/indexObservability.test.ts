import test from "node:test";
import assert from "node:assert/strict";
import {
  __resetPostgresTestConfig,
  __setPostgresTestConfig,
} from "./auth/postgresAuth";
import type { ExtractionResult } from "./extraction/types";
import type { IntelligencePipelineResult } from "./intelligence/types";

type QueryCall = {
  sql: string;
  params: unknown[] | undefined;
};

function createDatabaseMock(rowsQueue: Array<Array<Record<string, unknown>>> = []) {
  const calls: QueryCall[] = [];
  return {
    calls,
    db: {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        return {
          rows: rowsQueue.shift() ?? [],
          rowCount: 1,
        };
      },
      connect: async () => {
        throw new Error("connect should not be called in this test");
      },
    },
  };
}

function buildExtractionResult(): ExtractionResult {
  return {
    mode: "deep",
    metadata: {
      sourceUrl: "https://www.instagram.com/p/example/",
      canonicalUrl: "https://www.instagram.com/p/example/",
      platform: "instagram",
      title: "Example title",
      description: "Example description",
      siteName: "Instagram",
      imageUrl: "https://example.com/cover.jpg",
      fetchedAtIso: new Date().toISOString(),
      provider: "instagram_script",
      commentEvidence: {
        attempted: true,
        timedOut: false,
        pinnedComment: "Pinned venue comment",
        topComments: ["Top comment"],
        creatorReplies: ["Creator reply"],
        commentsFetchedCount: 3,
        commentRepliesFetchedCount: 1,
        creatorReplyCount: 1,
        provider: "instagram_script",
        reason: null,
      },
    },
    transcript: {
      attempted: true,
      used: false,
      source: "whisper",
      text: "",
      reason: "timeout",
    },
    ocr: {
      attempted: true,
      used: true,
      text: "Eva Cafe Anjuna",
      reason: null,
    },
    visualFallback: {
      attempted: true,
      triggered: true,
      reason: null,
      provider: "shared_visual_fallback",
      confidence: "medium",
      needsReview: true,
      screenshots: [],
      textQueries: ["Eva Cafe"],
      visualQueries: ["Eva Cafe Anjuna"],
      candidates: [],
      selectedCandidate: {
        query: "Eva Cafe Anjuna",
        source: "ocr_text",
        rationale: "OCR text",
        candidateName: "Eva Cafe",
        formattedAddress: "Anjuna, Goa",
        locality: "Anjuna",
        city: "Goa",
        state: "Goa",
        country: "India",
        placeId: "place-1",
        lat: null,
        lng: null,
        verificationConfidence: "medium",
        rankingScore: 0.8,
        matchedSignals: ["ocr"],
      },
      summaryText: "Visual candidate found",
    },
    attemptInfo: {
      attemptNumber: 1,
      triggerType: "initial",
    },
    source: "https://www.instagram.com/p/example/",
    platform: "instagram",
    canonicalUrl: "https://www.instagram.com/p/example/",
    stageStatus: {
      basicMetadata: "success",
      caption: "success",
      transcript: "partial",
      ocr: "success",
      visualFallback: "success",
    },
    stages: {
      basicMetadata: { status: "success", provider: "instagram_script", reason: null, chars: 32 },
      caption: { status: "success", provider: "instagram_script", reason: null, chars: 19 },
      transcript: { status: "partial", provider: "whisper", reason: "timeout", chars: 0 },
      ocr: { status: "success", provider: "frame_ocr", reason: null, chars: 15 },
      visualFallback: { status: "success", provider: "shared_visual_fallback", reason: null, chars: 20 },
    },
    stageTimingsMs: {
      basicMetadata: 1000,
      caption: 0,
      transcript: 20000,
      ocr: 5000,
      visualFallback: 7000,
    },
    debug: {
      orchestration: {
        acceptedAfter: "ocr",
        route: "attempt_1",
      },
    },
  };
}

function buildAuthSessionUserRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "user-1",
    email: "test@example.com",
    email_verified: true,
    phone_number: null,
    phone_verified: false,
    display_name: "Test User",
    avatar_url: null,
    auth_provider: "GOOGLE",
    provider_id: "google-1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test.afterEach(() => {
  __resetPostgresTestConfig();
  delete process.env.ADMIN_EMAILS;
});

test("createAnalyticsAttemptFromRequest links submitted link and promotes canonical url", async () => {
  process.env.NODE_ENV = "test";
  const mock = createDatabaseMock([
    [{ id: "run-1" }],
    [{ id: "attempt-1" }],
    [],
    [{ id: "submitted-1" }],
    [],
    [],
  ]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });

  const { createAnalyticsAttemptFromRequest } = await import("./index");
  const request = {
    body: {
      analytics: {
        clientRunId: "client-1",
        anonymousId: "anon-1",
        attemptNumber: 1,
        triggerType: "initial",
      },
    },
  } as any;

  const attempt = await createAnalyticsAttemptFromRequest(request, buildExtractionResult());

  assert.equal(attempt?.runId, "run-1");
  assert.equal(attempt?.attemptId, "attempt-1");
  const sqlText = mock.calls.map((call) => call.sql).join("\n");
  assert.match(sqlText, /insert into submitted_links/i);
  assert.match(sqlText, /update reel_analytics_runs\s+set\s+submitted_link_id/i);
  assert.match(sqlText, /update reel_analytics_attempts/i);
});

test("persistMetadataExtractionArtifacts writes promoted fields, stage rows, and evidence rows", async () => {
  process.env.NODE_ENV = "test";
  const mock = createDatabaseMock([
    [{ id: "run-1" }],
    [{ id: "attempt-1" }],
    [],
    [{ id: "submitted-1" }],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
  ]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });

  const { persistMetadataExtractionArtifacts, getFinalSelectedPlaceIdFromIntelligenceResult } = await import("./index");
  await persistMetadataExtractionArtifacts({
    body: {
      analytics: {
        clientRunId: "client-1",
        anonymousId: "anon-1",
        attemptNumber: 1,
        triggerType: "initial",
      },
    },
  } as any, buildExtractionResult() as Awaited<ReturnType<any>>);

  const sqlText = mock.calls.map((call) => call.sql).join("\n");
  assert.match(sqlText, /stage_status_json/i);
  assert.match(sqlText, /insert into attempt_stage_runs/i);
  assert.match(sqlText, /insert into attempt_evidence/i);

  const intelligenceResult: IntelligencePipelineResult = {
    output: {
      source: {
        url: null,
        platform: "instagram",
        title: null,
        creator: null,
        sourceType: "mixed_discovery",
      },
      placeCollections: [],
      categoriesPresent: ["eat"],
      weakMentions: [],
      showIn: { eat: true, do: false, stay: false, see: false },
      structuredEntities: [{
        name: "Eva Cafe",
        category: "eat",
        locality: "Anjuna",
        city: "Goa",
        state: "Goa",
        country: "India",
        address: "Anjuna, Goa",
        placeId: "place-1",
        confidence: "high",
        googleMapsQuery: "Eva Cafe Anjuna",
        evidenceText: "OCR",
      }],
      entities: [],
      visibility: { showIn: ["eat"], doNotShowIn: ["do", "stay", "see"], reason: null },
      status: "ready",
    },
    validationErrors: [],
    fixed: false,
  };
  assert.equal(getFinalSelectedPlaceIdFromIntelligenceResult(intelligenceResult), "place-1");
});

test("sync intelligence fast path persists accepted_after, route, and final_selected_place_id", async () => {
  process.env.NODE_ENV = "test";
  const mock = createDatabaseMock([
    [{ id: "run-1" }],
    [{ id: "attempt-1" }],
    [],
    [{ id: "submitted-1" }],
    [],
    [],
    [],
    [],
    [],
    [],
  ]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });

  const { app } = await import("./index");
  const source = buildExtractionResult();
  source.attemptInfo = {
    attemptNumber: 1,
    triggerType: "initial",
  };
  source.debug = {
    orchestration: {
      acceptedAfter: "description",
      route: "attempt_1_description_fast_path",
    },
    fastPathIntelligence: {
      accepted: true,
      result: {
        output: {
          source: {
            url: source.canonicalUrl,
            platform: "instagram",
            title: source.metadata.title,
            creator: null,
            sourceType: "mixed_discovery",
          },
          placeCollections: [],
          categoriesPresent: ["eat"],
          weakMentions: [],
          showIn: { eat: true, do: false, stay: false, see: false },
          structuredEntities: [{
            name: "Eva Cafe",
            category: "eat",
            locality: "Anjuna",
            city: "Goa",
            state: "Goa",
            country: "India",
            address: "Anjuna, Goa",
            placeId: "place-1",
            confidence: "high",
            googleMapsQuery: "Eva Cafe Anjuna",
            evidenceText: "Caption evidence",
          }],
          entities: [{
            category: "eat",
            name: "Eva Cafe",
            entityType: "place",
            city: "Goa",
            state: "Goa",
            country: "India",
            locality: "Anjuna",
            tags: [],
            details: {},
            level2: {
              category: "eat",
              cuisineType: null,
              mealType: null,
              dietaryTags: [],
              vibeTags: [],
              priceTier: null,
            },
            googleMapsQuery: "Eva Cafe Anjuna",
            sourceEvidence: "Caption evidence",
            confidence: "high",
            intent: {
              l1: "eat",
              l2: [],
              l3: [],
            },
          }],
          visibility: { showIn: ["eat"], doNotShowIn: ["do", "stay", "see"], reason: "Fast path" },
          status: "ready",
        },
        validationErrors: [],
        fixed: false,
        timingsMs: {
          total: 1,
          provider: 0,
          schemaFirstPass: 0,
          normalize: 0,
          schemaSecondPass: 0,
        },
        providerMeta: {
          model: "fast-path",
        },
      },
    },
  } as any;

  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/intelligence/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source,
        mode: "sync",
        analytics: {
          clientRunId: "client-1",
          anonymousId: "anon-1",
          attemptNumber: 1,
          triggerType: "initial",
        },
      }),
    });

    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const promotedCall = [...mock.calls].reverse().find((call) =>
    /accepted_after = coalesce/i.test(call.sql) && call.params?.[4] === "description" && call.params?.[5] === "attempt_1_description_fast_path",
  );
  assert.ok(promotedCall);
  assert.equal(promotedCall?.params?.[4], "description");
  assert.equal(promotedCall?.params?.[5], "attempt_1_description_fast_path");

  const finalOutcomeCall = mock.calls.find((call) => /final_selected_place_id = coalesce/i.test(call.sql));
  assert.ok(finalOutcomeCall);
  assert.equal(finalOutcomeCall?.params?.[2], "place-1");
});

test("edited reel event persists entity field diffs without changing save-discard behavior", async () => {
  process.env.NODE_ENV = "test";
  const mock = createDatabaseMock([
    [{ id: "run-1" }],
    [],
    [],
    [{ id: "run-1" }],
    [],
    [],
    [],
    [],
    [{ id: "run-2" }],
    [],
    [],
    [],
  ]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });

  const { app } = await import("./index");
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const editedResponse = await fetch(`http://127.0.0.1:${port}/api/analytics/reel-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientRunId: "client-1",
        anonymousId: "anon-1",
        attemptNumber: 1,
        eventName: "edited",
        sourceUrl: "https://www.instagram.com/p/example/",
        sourcePlatform: "instagram",
        entityIndex: 0,
        finalPlaceId: "place-2",
        payload: {
          entityIndex: 0,
          editDiffs: [
            { field: "title", before: "Old Cafe", after: "New Cafe" },
            { field: "subtitle", before: "Old Locality", after: "New Locality" },
            { field: "finalPlaceId", before: "place-1", after: "place-2" },
            { field: "lat", before: 12.1, after: 12.2 },
            { field: "ignoredField", before: "x", after: "y" },
          ],
        },
      }),
    });
    assert.equal(editedResponse.status, 201);

    const savedResponse = await fetch(`http://127.0.0.1:${port}/api/analytics/reel-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientRunId: "client-2",
        anonymousId: "anon-2",
        attemptNumber: 1,
        eventName: "saved",
        sourceUrl: "https://www.instagram.com/p/example/",
        sourcePlatform: "instagram",
        entityIndex: 0,
        finalPlaceId: "place-3",
        payload: {
          entityIndex: 0,
          editDiffs: [{ field: "title", before: "Should", after: "Ignore" }],
        },
      }),
    });
    assert.equal(savedResponse.status, 201);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const fieldEditCalls = mock.calls.filter((call) => /insert into entity_field_edits/i.test(call.sql));
  assert.equal(fieldEditCalls.length, 4);
  assert.deepEqual(
    fieldEditCalls.map((call) => call.params?.[7]),
    ["title", "subtitle", "finalPlaceId", "lat"],
  );
  assert.deepEqual(
    fieldEditCalls.map((call) => call.params?.[8]),
    ['"Old Cafe"', '"Old Locality"', '"place-1"', "12.1"],
  );
  assert.deepEqual(
    fieldEditCalls.map((call) => call.params?.[9]),
    ['"New Cafe"', '"New Locality"', '"place-2"', "12.2"],
  );
});

test("resolveMetadataDuplicateReuse reuses same-link extraction for same anonymous user", async () => {
  process.env.NODE_ENV = "test";
  const canonicalUrl = "https://www.instagram.com/p/example/";
  const mock = createDatabaseMock([[
    {
      submitted_link_id: "submitted-1",
      canonical_url: canonicalUrl,
      run_id: "run-1",
      client_run_id: "prior-client",
      user_id: null,
      anonymous_id: "anon-1",
      attempt_id: "attempt-1",
      attempt_number: 1,
      status: "queued",
      failure_reason: null,
      extraction_result_json: {
        source: canonicalUrl,
        canonicalUrl,
        platform: "instagram",
        metadata: {
          sourceUrl: canonicalUrl,
          canonicalUrl,
          platform: "instagram",
        },
        attemptInfo: {
          attemptNumber: 1,
          triggerType: "initial",
        },
      },
      intelligence_status: "ready",
    },
  ]]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });

  const { resolveMetadataDuplicateReuse } = await import("./index");
  const result = await resolveMetadataDuplicateReuse({
    canonicalUrl,
    anonymousId: "anon-1",
  });

  assert.equal(result?.duplicate.scope, "same_user");
  assert.equal(result?.duplicate.reused, true);
  assert.equal(result?.duplicate.costSaved, true);
  assert.equal(result?.duplicate.reusedRunId, "run-1");
  assert.equal(result?.duplicate.reusedAttemptNumber, 1);
});

test("resolveMetadataDuplicateReuse does not reuse failed or incomplete previous results", async () => {
  process.env.NODE_ENV = "test";
  const mock = createDatabaseMock([[]]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });

  const { resolveMetadataDuplicateReuse } = await import("./index");
  const result = await resolveMetadataDuplicateReuse({
    canonicalUrl: "https://www.instagram.com/p/example/",
    anonymousId: "anon-1",
  });

  assert.equal(result, null);
});

test("metadata extract reuses same-link extraction and returns duplicate metadata for different anonymous user", async () => {
  process.env.NODE_ENV = "test";
  const canonicalUrl = "https://www.instagram.com/p/example";
  const mock = createDatabaseMock([
    [{
      submitted_link_id: "submitted-1",
      canonical_url: canonicalUrl,
      run_id: "run-1",
      client_run_id: "prior-client",
      user_id: null,
      anonymous_id: "anon-1",
      attempt_id: "attempt-1",
      attempt_number: 1,
      status: "queued",
      failure_reason: null,
      extraction_result_json: {
        source: canonicalUrl,
        canonicalUrl,
        platform: "instagram",
        metadata: {
          sourceUrl: canonicalUrl,
          canonicalUrl,
          platform: "instagram",
          title: "Reused title",
        },
        attemptInfo: {
          attemptNumber: 1,
          triggerType: "initial",
        },
      },
      intelligence_status: "ready",
    }],
    [{ id: "run-2" }],
    [{ id: "attempt-2" }],
    [],
    [{ id: "submitted-1" }],
    [],
    [],
    [],
    [],
  ]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });

  const { app } = await import("./index");
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/metadata/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: `${canonicalUrl}/`,
        analytics: {
          clientRunId: "client-2",
          anonymousId: "anon-2",
          attemptNumber: 1,
          triggerType: "initial",
        },
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.metadata?.title, "Reused title");
    assert.deepEqual(body.duplicate, {
      kind: "link",
      scope: "different_user",
      canonicalUrl,
      submittedLinkId: "submitted-1",
      reused: true,
      costSaved: true,
      reusedRunId: "run-1",
      reusedAttemptNumber: 1,
      priorStatus: "ready",
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("saved places route returns alreadySaved for same user and same place without duplicate insert", async () => {
  process.env.NODE_ENV = "test";
  const mock = createDatabaseMock([
    [buildAuthSessionUserRow()],
    [{
      id: "saved-1",
      user_id: "user-1",
      place_id: "place-1",
      title: "Eva Cafe",
      category: "Taste",
      metadata_json: { locality: "Anjuna" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }],
  ]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });

  const { app } = await import("./index");
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/saved-places`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "wr_session=test-token" },
      body: JSON.stringify({
        placeId: "place-1",
        title: "Eva Cafe",
        category: "Taste",
        metadata: { locality: "Anjuna" },
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.alreadySaved, true);
    assert.deepEqual(body.duplicate, {
      kind: "place",
      scope: "same_user",
      placeId: "place-1",
      existingSavedPlaceId: "saved-1",
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  assert.equal(mock.calls.filter((call) => /insert into user_saved_places/i.test(call.sql)).length, 0);
});

test("saved places route allows different user to save same place normally", async () => {
  process.env.NODE_ENV = "test";
  const mock = createDatabaseMock([
    [buildAuthSessionUserRow({ id: "user-2", email: "user2@example.com" })],
    [],
    [],
    [{
      id: "saved-2",
      user_id: "user-2",
      place_id: "place-1",
      title: "Eva Cafe",
      category: "Taste",
      metadata_json: { locality: "Anjuna" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }],
  ]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });

  const { app } = await import("./index");
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/saved-places`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "wr_session=test-token" },
      body: JSON.stringify({
        placeId: "place-1",
        title: "Eva Cafe",
        category: "Taste",
        metadata: { locality: "Anjuna" },
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.alreadySaved, false);
    assert.equal(body.item?.id, "saved-2");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  assert.equal(mock.calls.filter((call) => /insert into user_saved_places/i.test(call.sql)).length, 1);
});

test("saved places route saves normally when placeId is missing by using stable fallback", async () => {
  process.env.NODE_ENV = "test";
  const mock = createDatabaseMock([
    [buildAuthSessionUserRow()],
    [],
    [],
    [{
      id: "saved-3",
      user_id: "user-1",
      place_id: "manual:test",
      title: "Manual Cafe",
      category: "Taste",
      metadata_json: { locality: "Anjuna" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }],
  ]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });

  const { app } = await import("./index");
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/saved-places`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "wr_session=test-token" },
      body: JSON.stringify({
        title: "Manual Cafe",
        category: "Taste",
        metadata: { locality: "Anjuna" },
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.alreadySaved, false);
    assert.equal(body.item?.id, "saved-3");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const insertCall = mock.calls.find((call) => /insert into user_saved_places/i.test(call.sql));
  assert.ok(insertCall);
  assert.match(String(insertCall?.params?.[2] || ""), /^manual:/);
});

test("admin overview requires authentication", async () => {
  process.env.NODE_ENV = "test";
  process.env.ADMIN_EMAILS = "admin@example.com";
  const mock = createDatabaseMock([]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });

  const { app } = await import("./index");
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/observability/overview`);
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.ok, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("admin overview forbids authenticated non-admin users", async () => {
  process.env.NODE_ENV = "test";
  process.env.ADMIN_EMAILS = "admin@example.com";
  const mock = createDatabaseMock([
    [buildAuthSessionUserRow({ email: "user@example.com" })],
  ]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });

  const { app } = await import("./index");
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/observability/overview`, {
      headers: { Cookie: "wr_session=test-token" },
    });
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.ok, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("admin overview returns aggregated response shape for admin users", async () => {
  process.env.NODE_ENV = "test";
  process.env.ADMIN_EMAILS = "admin@example.com";
  const mock = createDatabaseMock([
    [buildAuthSessionUserRow({ email: "admin@example.com" })],
    [{
      total_submitted_links: "12",
      total_runs: "10",
      total_attempts: "14",
      saved_runs: "4",
      edited_runs: "2",
      discarded_runs: "1",
      average_attempt_count: "1.4",
      average_extraction_time_ms: "8123.5",
      estimated_cache_reuse_count: "3",
      estimated_duplicate_saved_place_count: "1",
    }],
  ]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });

  const { app } = await import("./index");
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/observability/overview?from=2026-06-01&to=2026-06-21&platform=instagram`, {
      headers: { Cookie: "wr_session=test-token" },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.totals, {
      submittedLinks: 12,
      runs: 10,
      attempts: 14,
      savedRuns: 4,
      editedRuns: 2,
      discardedRuns: 1,
    });
    assert.deepEqual(body.rates, {
      saveRate: 0.4,
      editRate: 0.2,
      discardRate: 0.1,
    });
    assert.deepEqual(body.averages, {
      attemptCount: 1.4,
      extractionTimeMs: 8123.5,
    });
    assert.deepEqual(body.estimates, {
      cacheReuseCount: 3,
      duplicateSavedPlaceCount: 1,
      cacheReuseIsEstimated: true,
      duplicateSavedPlaceIsEstimated: true,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("admin links denies unauthenticated requests", async () => {
  process.env.NODE_ENV = "test";
  process.env.ADMIN_EMAILS = "admin@example.com";
  const mock = createDatabaseMock([]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });

  const { app } = await import("./index");
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/observability/links`);
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.ok, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("admin links forbids authenticated non-admin users", async () => {
  process.env.NODE_ENV = "test";
  process.env.ADMIN_EMAILS = "admin@example.com";
  const mock = createDatabaseMock([
    [buildAuthSessionUserRow({ email: "user@example.com" })],
  ]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });

  const { app } = await import("./index");
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/observability/links`, {
      headers: { Cookie: "wr_session=test-token" },
    });
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.ok, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("admin links returns paginated response shape for admin users", async () => {
  process.env.NODE_ENV = "test";
  process.env.ADMIN_EMAILS = "admin@example.com";
  const mock = createDatabaseMock([
    [buildAuthSessionUserRow({ email: "admin@example.com" })],
    [{ total: "25" }], // count query
    [
      {
        submitted_link_id: "link-1",
        canonical_url: "https://instagram.com/p/abc123",
        platform: "instagram",
        first_seen_at: "2026-06-01T10:00:00Z",
        last_seen_at: "2026-06-21T15:30:00Z",
        run_count: "3",
        attempt_count: "2",
        latest_status: "completed",
        latest_accepted_after: "ocr",
        latest_route: "extract_then_intelligence",
        cache_reuse_count: "2",
        final_selected_place_id: "place-456",
        final_user_action: "saved",
      },
      {
        submitted_link_id: "link-2",
        canonical_url: "https://youtube.com/watch?v=xyz789",
        platform: "youtube",
        first_seen_at: "2026-06-05T12:00:00Z",
        last_seen_at: "2026-06-20T18:00:00Z",
        run_count: "1",
        attempt_count: "1",
        latest_status: "completed",
        latest_accepted_after: null,
        latest_route: "visual_search",
        cache_reuse_count: "0",
        final_selected_place_id: null,
        final_user_action: null,
      },
    ],
  ]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });

  const { app } = await import("./index");
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/observability/links?from=2026-06-01&to=2026-06-21&platform=instagram&page=1&pageSize=50`, {
      headers: { Cookie: "wr_session=test-token" },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.pagination, {
      total: 25,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });
    assert.equal(body.rows.length, 2);
    assert.deepEqual(body.rows[0], {
      submittedLinkId: "link-1",
      canonicalUrl: "https://instagram.com/p/abc123",
      platform: "instagram",
      firstSeenAt: "2026-06-01T10:00:00Z",
      lastSeenAt: "2026-06-21T15:30:00Z",
      runCount: 3,
      attemptCount: 2,
      latestStatus: "completed",
      latestAcceptedAfter: "ocr",
      latestRoute: "extract_then_intelligence",
      cacheReuseCount: 2,
      finalSelectedPlaceId: "place-456",
      finalUserAction: "saved",
    });
    assert.deepEqual(body.rows[1], {
      submittedLinkId: "link-2",
      canonicalUrl: "https://youtube.com/watch?v=xyz789",
      platform: "youtube",
      firstSeenAt: "2026-06-05T12:00:00Z",
      lastSeenAt: "2026-06-20T18:00:00Z",
      runCount: 1,
      attemptCount: 1,
      latestStatus: "completed",
      latestAcceptedAfter: null,
      latestRoute: "visual_search",
      cacheReuseCount: 0,
      finalSelectedPlaceId: null,
      finalUserAction: null,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("admin links accepts filter parameters", async () => {
  process.env.NODE_ENV = "test";
  process.env.ADMIN_EMAILS = "admin@example.com";
  const mock = createDatabaseMock([
    [buildAuthSessionUserRow({ email: "admin@example.com" })],
    [{ total: "5" }],
    [],
  ]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });

  const { app } = await import("./index");
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/observability/links?status=completed&reused=true&acceptedAfter=ocr&q=instagram.com&page=1&pageSize=20`, {
      headers: { Cookie: "wr_session=test-token" },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.pagination, {
      total: 5,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("admin link detail endpoint access control and includeRaw", async () => {
  process.env.NODE_ENV = "test";
  process.env.ADMIN_EMAILS = "admin@example.com";
  const mock = createDatabaseMock([
    // session user (admin)
    [buildAuthSessionUserRow({ email: "admin@example.com" })],
    // submitted link
    [
      {
        id: "submitted-1",
        canonical_url: "https://instagram.com/p/example",
        source_platform: "instagram",
        first_seen_at: "2026-06-01T10:00:00Z",
        last_seen_at: "2026-06-21T15:30:00Z",
      },
    ],
    // runs
    [
      {
        id: "run-1",
        client_run_id: "client-1",
        user_id: "user-1",
        anonymous_id: null,
        source_url: "https://instagram.com/p/example",
        source_platform: "instagram",
        latest_outcome: "completed",
        latest_attempt_number: 1,
        created_at: "2026-06-01T10:01:00Z",
        updated_at: "2026-06-01T10:05:00Z",
      },
    ],
    // attempts
    [
      { id: "attempt-1", run_id: "run-1", attempt_number: 1, trigger_type: "manual", status: "completed", extraction_result_json: { x: 1 }, intelligence_result_json: null, created_at: "2026-06-01T10:02:00Z" },
    ],
    // stages
    [],
    // evidence
    [],
    // entities
    [],
    // events
    [],
    // edits
    [],
    // duplicated set for second call
    [buildAuthSessionUserRow({ email: "admin@example.com" })],
    [
      {
        id: "submitted-1",
        canonical_url: "https://instagram.com/p/example",
        source_platform: "instagram",
        first_seen_at: "2026-06-01T10:00:00Z",
        last_seen_at: "2026-06-21T15:30:00Z",
      },
    ],
    [
      {
        id: "run-1",
        client_run_id: "client-1",
        user_id: "user-1",
        anonymous_id: null,
        source_url: "https://instagram.com/p/example",
        source_platform: "instagram",
        latest_outcome: "completed",
        latest_attempt_number: 1,
        created_at: "2026-06-01T10:01:00Z",
        updated_at: "2026-06-01T10:05:00Z",
      },
    ],
    [
      { id: "attempt-1", run_id: "run-1", attempt_number: 1, trigger_type: "manual", status: "completed", extraction_result_json: { x: 1 }, intelligence_result_json: null, created_at: "2026-06-01T10:02:00Z" },
    ],
    [],
    [],
    [],
    [],
    [],
  ]);

  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });

  const { app } = await import("./index");
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    // unauthenticated
    const unauth = await fetch(`http://127.0.0.1:${port}/api/admin/observability/links/submitted-1`);
    const bodyUnauth = await unauth.json();
    assert.equal(unauth.status, 401);
    assert.equal(bodyUnauth.ok, false);

    // authenticated admin
    const auth = await fetch(`http://127.0.0.1:${port}/api/admin/observability/links/submitted-1?includeRaw=false`, {
      headers: { Cookie: "wr_session=test-token" },
    });
    const body = await auth.json();
    assert.equal(auth.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.submittedLink.id, "submitted-1");
    // raw hidden
    assert.equal(body.runs[0].attempts[0].extractionResult, null);

    // includeRaw true
    const rawResp = await fetch(`http://127.0.0.1:${port}/api/admin/observability/links/submitted-1?includeRaw=true`, {
      headers: { Cookie: "wr_session=test-token" },
    });
    const rawBody = await rawResp.json();
    assert.equal(rawResp.status, 200);
    assert.equal(rawBody.ok, true);
    assert.equal(rawBody.runs[0].attempts[0].extractionResult.x, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


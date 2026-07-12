// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { OAuth2Client } from "google-auth-library";
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

function createTransactionalDatabaseMock(
  handler: (sql: string, params?: unknown[]) => Array<Record<string, unknown>> | undefined,
) {
  const calls: QueryCall[] = [];
  const query = async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    return {
      rows: handler(sql, params) ?? [],
      rowCount: 1,
    };
  };

  return {
    calls,
    db: {
      query,
      connect: async () => ({
        query,
        release: () => undefined,
      }),
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
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_WEB_CLIENT_ID;
  delete process.env.GOOGLE_ANDROID_CLIENT_ID;
});

test("google verify rejects requests without any token", async () => {
  process.env.NODE_ENV = "test";
  process.env.GOOGLE_WEB_CLIENT_ID = "web-client-id.apps.googleusercontent.com";
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
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/google/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error, "idToken or accessToken is required");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("google verify accepts native idToken logins and sets a session cookie", async () => {
  process.env.NODE_ENV = "test";
  process.env.GOOGLE_WEB_CLIENT_ID = "web-client-id.apps.googleusercontent.com";
  const mock = createTransactionalDatabaseMock((sql) => {
    if (/select \* from users where email = \$1 limit 1 for update/i.test(sql)) return [];
    if (/insert into users/i.test(sql)) {
      return [
        buildAuthSessionUserRow({
          email: "native@example.com",
          display_name: "Native User",
          avatar_url: "https://example.com/avatar.png",
          provider_id: "google-sub-1",
        }),
      ];
    }
    return [];
  });
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });

  const originalVerifyIdToken = OAuth2Client.prototype.verifyIdToken;
  OAuth2Client.prototype.verifyIdToken = async function verifyIdTokenMock() {
    return {
      getPayload: () => ({
        iss: "https://accounts.google.com",
        aud: "web-client-id.apps.googleusercontent.com",
        sub: "google-sub-1",
        email: "native@example.com",
        email_verified: true,
        name: "Native User",
        picture: "https://example.com/avatar.png",
      }),
    } as any;
  };

  const { app } = await import("./index");
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/google/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "native-id-token" }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.user?.email, "native@example.com");
    assert.match(String(response.headers.get("set-cookie") || ""), /wr_session=/);
    assert.ok(mock.calls.some((call) => /insert into auth_sessions/i.test(call.sql)));
  } finally {
    OAuth2Client.prototype.verifyIdToken = originalVerifyIdToken;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("google verify rejects native idToken audience mismatches safely", async () => {
  process.env.NODE_ENV = "test";
  process.env.GOOGLE_WEB_CLIENT_ID = "web-client-id.apps.googleusercontent.com";
  const mock = createDatabaseMock([]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });

  const originalVerifyIdToken = OAuth2Client.prototype.verifyIdToken;
  OAuth2Client.prototype.verifyIdToken = async function verifyIdTokenAudienceMismatchMock() {
    return {
      getPayload: () => ({
        iss: "https://accounts.google.com",
        aud: "wrong-client-id.apps.googleusercontent.com",
        sub: "google-sub-1",
        email: "native@example.com",
        email_verified: true,
      }),
    } as any;
  };

  const { app } = await import("./index");
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/google/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "native-id-token" }),
    });
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.ok, false);
    assert.equal(body.error, "Google token audience mismatch.");
  } finally {
    OAuth2Client.prototype.verifyIdToken = originalVerifyIdToken;
    await new Promise((resolve) => server.close(resolve));
  }
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

async function fetchHeroCardForSavedPlaces(
  savedRows: Array<Record<string, unknown>>,
  options: {
    readyStrollRows?: Array<Record<string, unknown>>;
    authUserOverrides?: Partial<Record<string, unknown>>;
  } = {},
) {
  process.env.NODE_ENV = "test";
  const mock = createDatabaseMock([
    [buildAuthSessionUserRow(options.authUserOverrides)],
    savedRows,
    options.readyStrollRows ?? [],
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
    const response = await fetch(`http://127.0.0.1:${port}/api/hero-card`, {
      headers: { Cookie: "wr_session=test-token" },
    });
    const body = await response.json() as any;
    return { response, body, calls: mock.calls };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("hero card prefers Taste-heavy insight over a generic dominant city card", async () => {
  const { response, body } = await fetchHeroCardForSavedPlaces([
    {
      id: "saved-1",
      user_id: "user-1",
      place_id: "place-1",
      title: "Cafe One",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Anjuna" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }, {
      id: "saved-2",
      user_id: "user-1",
      place_id: "place-2",
      title: "Cafe Two",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Vagator" },
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    }, {
      id: "saved-3",
      user_id: "user-1",
      place_id: "place-3",
      title: "Cafe Three",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Morjim" },
      created_at: "2026-01-03T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:00.000Z",
    }, {
      id: "saved-4",
      user_id: "user-1",
      place_id: "place-4",
      title: "Cafe Four",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Assagao" },
      created_at: "2026-01-04T00:00:00.000Z",
      updated_at: "2026-01-04T00:00:00.000Z",
    }, {
      id: "saved-5",
      user_id: "user-1",
      place_id: "place-5",
      title: "Cafe Five",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Siolim" },
      created_at: "2026-01-05T00:00:00.000Z",
      updated_at: "2026-01-05T00:00:00.000Z",
    }, {
      id: "saved-6",
      user_id: "user-1",
      place_id: "place-6",
      title: "Beach Walk",
      category: "Explore",
      metadata_json: { city: "Goa", locality: "Calangute" },
      created_at: "2026-01-06T00:00:00.000Z",
      updated_at: "2026-01-06T00:00:00.000Z",
    },
  ]);

  assert.equal(response.status, 200);
  assert.equal(body.type, "city_category_insight");
  assert.equal(body.metadata?.rule, "taste_trail");
  assert.equal(body.metadata?.targetCategory, "Taste");
  assert.equal(body.ctaAction, "build_food_trail");
  assert.ok((body.priorityScore || 0) > 0);
  assert.equal(typeof body.cardKey, "string");
  assert.ok(Array.isArray(body.alternatives));
});

test("hero card prefers Explore-heavy insight over a generic dominant city card", async () => {
  const { response, body } = await fetchHeroCardForSavedPlaces([
    {
      id: "saved-1",
      user_id: "user-1",
      place_id: "place-1",
      title: "Spot One",
      category: "Explore",
      metadata_json: { city: "Jaipur", locality: "Amer" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }, {
      id: "saved-2",
      user_id: "user-1",
      place_id: "place-2",
      title: "Spot Two",
      category: "Explore",
      metadata_json: { city: "Jaipur", locality: "Pink City" },
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    }, {
      id: "saved-3",
      user_id: "user-1",
      place_id: "place-3",
      title: "Spot Three",
      category: "Explore",
      metadata_json: { city: "Jaipur", locality: "Bapu Nagar" },
      created_at: "2026-01-03T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:00.000Z",
    }, {
      id: "saved-4",
      user_id: "user-1",
      place_id: "place-4",
      title: "Spot Four",
      category: "Explore",
      metadata_json: { city: "Jaipur", locality: "Nahargarh" },
      created_at: "2026-01-04T00:00:00.000Z",
      updated_at: "2026-01-04T00:00:00.000Z",
    }, {
      id: "saved-5",
      user_id: "user-1",
      place_id: "place-5",
      title: "Spot Five",
      category: "Explore",
      metadata_json: { city: "Jaipur", locality: "Jal Mahal" },
      created_at: "2026-01-05T00:00:00.000Z",
      updated_at: "2026-01-05T00:00:00.000Z",
    }, {
      id: "saved-6",
      user_id: "user-1",
      place_id: "place-6",
      title: "Cafe Six",
      category: "Taste",
      metadata_json: { city: "Jaipur", locality: "C Scheme" },
      created_at: "2026-01-06T00:00:00.000Z",
      updated_at: "2026-01-06T00:00:00.000Z",
    },
  ]);

  assert.equal(response.status, 200);
  assert.equal(body.metadata?.rule, "explore_weekend");
  assert.equal(body.metadata?.targetCategory, "Explore");
  assert.equal(body.ctaAction, "plan_weekend_explore");
});

test("hero card does not create a city card from locality-only data", async () => {
  const { response, body } = await fetchHeroCardForSavedPlaces([
    {
      id: "saved-1",
      user_id: "user-1",
      place_id: "place-1",
      title: "One",
      category: "Activity",
      metadata_json: { locality: "Anjuna" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }, {
      id: "saved-2",
      user_id: "user-1",
      place_id: "place-2",
      title: "Two",
      category: "Activity",
      metadata_json: { locality: "Anjuna" },
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    }, {
      id: "saved-3",
      user_id: "user-1",
      place_id: "place-3",
      title: "Three",
      category: "Activity",
      metadata_json: { locality: "Anjuna" },
      created_at: "2026-01-03T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:00.000Z",
    }, {
      id: "saved-4",
      user_id: "user-1",
      place_id: "place-4",
      title: "Four",
      category: "Stay",
      metadata_json: { locality: "Vagator" },
      created_at: "2026-01-04T00:00:00.000Z",
      updated_at: "2026-01-04T00:00:00.000Z",
    },
  ]);

  assert.equal(response.status, 200);
  assert.notEqual(body.metadata?.rule, "dominant_city");
  assert.equal(body.metadata?.targetCity ?? null, null);
});

test("hero card can return itinerary-ready when total saves are high", async () => {
  const savedRows = Array.from({ length: 12 }, (_, index) => ({
    id: `saved-${index + 1}`,
    user_id: "user-1",
    place_id: `place-${index + 1}`,
    title: `Place ${index + 1}`,
    category: ["Taste", "Explore", "Stay", "Activity"][index % 4],
    metadata_json: { city: index < 4 ? "Goa" : index < 8 ? "Jaipur" : "Delhi", locality: `Locality ${index + 1}` },
    created_at: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    updated_at: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
  }));
  const { response, body } = await fetchHeroCardForSavedPlaces(savedRows);

  assert.equal(response.status, 200);
  assert.equal(body.metadata?.rule, "itinerary_ready");
  assert.equal(body.ctaAction, "create_itinerary");
  assert.equal(body.metadata?.totalSavedPlaces, 12);
});

test("hero card metadata includes actionable fields for future CTA handlers", async () => {
  const { response, body } = await fetchHeroCardForSavedPlaces([
    {
      id: "saved-1",
      user_id: "user-1",
      place_id: "place-1",
      title: "Cafe One",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Anjuna" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }, {
      id: "saved-2",
      user_id: "user-1",
      place_id: "place-2",
      title: "Cafe Two",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Vagator" },
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    }, {
      id: "saved-3",
      user_id: "user-1",
      place_id: "place-3",
      title: "Cafe Three",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Morjim" },
      created_at: "2026-01-03T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:00.000Z",
    }, {
      id: "saved-4",
      user_id: "user-1",
      place_id: "place-4",
      title: "Cafe Four",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Assagao" },
      created_at: "2026-01-04T00:00:00.000Z",
      updated_at: "2026-01-04T00:00:00.000Z",
    }, {
      id: "saved-5",
      user_id: "user-1",
      place_id: "place-5",
      title: "Cafe Five",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Siolim" },
      created_at: "2026-01-05T00:00:00.000Z",
      updated_at: "2026-01-05T00:00:00.000Z",
    },
  ]);

  assert.equal(response.status, 200);
  assert.equal(typeof body.cardKey, "string");
  assert.ok(Array.isArray(body.reasonCodes));
  assert.ok(typeof body.priorityScore === "number");
  assert.equal(body.metadata?.targetCategory, "Taste");
  assert.equal(body.metadata?.targetCity ?? null, null);
  assert.ok(Array.isArray(body.metadata?.matchingPlaceIds));
  assert.ok(body.metadata?.matchingPlaceIds.includes("place-1"));
  assert.deepEqual(body.metadata?.reasonCodes, body.reasonCodes);
  assert.equal(body.metadata?.priorityScore, body.priorityScore);
  assert.equal(body.metadata?.queryParams?.category, "Taste");
});

test("hero card returns ordered alternatives with stable card keys", async () => {
  const { response, body } = await fetchHeroCardForSavedPlaces([
    {
      id: "saved-1",
      user_id: "user-1",
      place_id: "place-1",
      title: "Cafe One",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Anjuna" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }, {
      id: "saved-2",
      user_id: "user-1",
      place_id: "place-2",
      title: "Cafe Two",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Vagator" },
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    }, {
      id: "saved-3",
      user_id: "user-1",
      place_id: "place-3",
      title: "Cafe Three",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Morjim" },
      created_at: "2026-01-03T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:00.000Z",
    }, {
      id: "saved-4",
      user_id: "user-1",
      place_id: "place-4",
      title: "Cafe Four",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Assagao" },
      created_at: "2026-01-04T00:00:00.000Z",
      updated_at: "2026-01-04T00:00:00.000Z",
    }, {
      id: "saved-5",
      user_id: "user-1",
      place_id: "place-5",
      title: "Cafe Five",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Siolim" },
      created_at: "2026-01-05T00:00:00.000Z",
      updated_at: "2026-01-05T00:00:00.000Z",
    }, {
      id: "saved-6",
      user_id: "user-1",
      place_id: "place-6",
      title: "Walk One",
      category: "Explore",
      metadata_json: { city: "Goa", locality: "Calangute" },
      created_at: "2026-01-06T00:00:00.000Z",
      updated_at: "2026-01-06T00:00:00.000Z",
    }, {
      id: "saved-7",
      user_id: "user-1",
      place_id: "place-7",
      title: "Walk Two",
      category: "Explore",
      metadata_json: { city: "Goa", locality: "Candolim" },
      created_at: "2026-01-07T00:00:00.000Z",
      updated_at: "2026-01-07T00:00:00.000Z",
    }, {
      id: "saved-8",
      user_id: "user-1",
      place_id: "place-8",
      title: "Hotel One",
      category: "Stay",
      metadata_json: { city: "Goa", locality: "Panjim" },
      created_at: "2026-01-08T00:00:00.000Z",
      updated_at: "2026-01-08T00:00:00.000Z",
    }, {
      id: "saved-9",
      user_id: "user-1",
      place_id: "place-9",
      title: "Activity One",
      category: "Activity",
      metadata_json: { city: "Goa", locality: "Mapusa" },
      created_at: "2026-01-09T00:00:00.000Z",
      updated_at: "2026-01-09T00:00:00.000Z",
    }, {
      id: "saved-10",
      user_id: "user-1",
      place_id: "place-10",
      title: "Activity Two",
      category: "Activity",
      metadata_json: { city: "Goa", locality: "Arpora" },
      created_at: "2026-01-10T00:00:00.000Z",
      updated_at: "2026-01-10T00:00:00.000Z",
    }, {
      id: "saved-11",
      user_id: "user-1",
      place_id: "place-11",
      title: "Explore Three",
      category: "Explore",
      metadata_json: { city: "Goa", locality: "Baga" },
      created_at: "2026-01-11T00:00:00.000Z",
      updated_at: "2026-01-11T00:00:00.000Z",
    }, {
      id: "saved-12",
      user_id: "user-1",
      place_id: "place-12",
      title: "Explore Four",
      category: "Explore",
      metadata_json: { city: "Goa", locality: "Colva" },
      created_at: "2026-01-12T00:00:00.000Z",
      updated_at: "2026-01-12T00:00:00.000Z",
    },
  ]);

  assert.equal(response.status, 200);
  assert.equal(body.metadata?.rule, "taste_trail");
  assert.equal(typeof body.cardKey, "string");
  assert.ok(Array.isArray(body.alternatives));
  assert.equal(body.alternatives.length, 2);
  assert.deepEqual(
    body.alternatives.map((item: any) => item.metadata?.rule),
    ["dominant_city", "itinerary_ready"],
  );
  assert.ok(body.alternatives.every((item: any) => typeof item.cardKey === "string"));
  assert.ok(body.alternatives.every((item: any) => typeof item.priorityScore === "number"));
  assert.ok(body.alternatives.every((item: any) => Array.isArray(item.reasonCodes)));
  assert.ok(body.alternatives.every((item: any) => item.metadata && typeof item.metadata === "object"));
});

test("hero card keys differ across different rule families", async () => {
  const tasteTrail = await fetchHeroCardForSavedPlaces([
    {
      id: "saved-1",
      user_id: "user-1",
      place_id: "place-1",
      title: "Cafe One",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Anjuna" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }, {
      id: "saved-2",
      user_id: "user-1",
      place_id: "place-2",
      title: "Cafe Two",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Anjuna" },
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    }, {
      id: "saved-3",
      user_id: "user-1",
      place_id: "place-3",
      title: "Cafe Three",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Vagator" },
      created_at: "2026-01-03T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:00.000Z",
    }, {
      id: "saved-4",
      user_id: "user-1",
      place_id: "place-4",
      title: "Cafe Four",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Siolim" },
      created_at: "2026-01-04T00:00:00.000Z",
      updated_at: "2026-01-04T00:00:00.000Z",
    }, {
      id: "saved-5",
      user_id: "user-1",
      place_id: "place-5",
      title: "Cafe Five",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Morjim" },
      created_at: "2026-01-05T00:00:00.000Z",
      updated_at: "2026-01-05T00:00:00.000Z",
    }, {
      id: "saved-6",
      user_id: "user-1",
      place_id: "place-6",
      title: "Walk One",
      category: "Explore",
      metadata_json: { city: "Goa", locality: "Baga" },
      created_at: "2026-01-06T00:00:00.000Z",
      updated_at: "2026-01-06T00:00:00.000Z",
    },
  ]);
  const dominantCategory = await fetchHeroCardForSavedPlaces([
    {
      id: "saved-1",
      user_id: "user-1",
      place_id: "place-1",
      title: "Cafe One",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Anjuna" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }, {
      id: "saved-2",
      user_id: "user-1",
      place_id: "place-2",
      title: "Cafe Two",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Anjuna" },
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    }, {
      id: "saved-3",
      user_id: "user-1",
      place_id: "place-3",
      title: "Cafe Three",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Vagator" },
      created_at: "2026-01-03T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:00.000Z",
    }, {
      id: "saved-4",
      user_id: "user-1",
      place_id: "place-4",
      title: "Cafe Four",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Siolim" },
      created_at: "2026-01-04T00:00:00.000Z",
      updated_at: "2026-01-04T00:00:00.000Z",
    }, {
      id: "saved-5",
      user_id: "user-1",
      place_id: "place-5",
      title: "Walk One",
      category: "Explore",
      metadata_json: { city: "Goa", locality: "Baga" },
      created_at: "2026-01-05T00:00:00.000Z",
      updated_at: "2026-01-05T00:00:00.000Z",
    }, {
      id: "saved-6",
      user_id: "user-1",
      place_id: "place-6",
      title: "Walk Two",
      category: "Explore",
      metadata_json: { city: "Goa", locality: "Candolim" },
      created_at: "2026-01-06T00:00:00.000Z",
      updated_at: "2026-01-06T00:00:00.000Z",
    },
  ]);

  assert.equal(tasteTrail.body.metadata?.rule, "taste_trail");
  assert.equal(dominantCategory.body.metadata?.rule, "dominant_category");
  assert.notEqual(tasteTrail.body.cardKey, dominantCategory.body.cardKey);
});

test("hero card ignores admin-region city values for city cards", async () => {
  const { response, body } = await fetchHeroCardForSavedPlaces([
    {
      id: "saved-1",
      user_id: "user-1",
      place_id: "place-1",
      title: "Spot One",
      category: "Taste",
      metadata_json: { city: "Bangalore Division", locality: "Indiranagar" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }, {
      id: "saved-2",
      user_id: "user-1",
      place_id: "place-2",
      title: "Spot Two",
      category: "Explore",
      metadata_json: { city: "Bangalore Division", locality: "HSR Layout" },
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    }, {
      id: "saved-3",
      user_id: "user-1",
      place_id: "place-3",
      title: "Spot Three",
      category: "Stay",
      metadata_json: { city: "Bangalore Division", locality: "Whitefield" },
      created_at: "2026-01-03T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:00.000Z",
    }, {
      id: "saved-4",
      user_id: "user-1",
      place_id: "place-4",
      title: "Spot Four",
      category: "Activity",
      metadata_json: { city: "Bangalore Division", locality: "Koramangala" },
      created_at: "2026-01-04T00:00:00.000Z",
      updated_at: "2026-01-04T00:00:00.000Z",
    },
  ]);

  assert.equal(response.status, 200);
  assert.notEqual(body.metadata?.rule, "dominant_city");
  assert.equal(body.metadata?.targetCity ?? null, null);
});

test("hero card de-duplicates redundant alternatives", async () => {
  const { response, body } = await fetchHeroCardForSavedPlaces([
    {
      id: "saved-1",
      user_id: "user-1",
      place_id: "place-1",
      title: "Cafe One",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Anjuna" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }, {
      id: "saved-2",
      user_id: "user-1",
      place_id: "place-2",
      title: "Cafe Two",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Anjuna" },
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    }, {
      id: "saved-3",
      user_id: "user-1",
      place_id: "place-3",
      title: "Cafe Three",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Vagator" },
      created_at: "2026-01-03T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:00.000Z",
    }, {
      id: "saved-4",
      user_id: "user-1",
      place_id: "place-4",
      title: "Cafe Four",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Siolim" },
      created_at: "2026-01-04T00:00:00.000Z",
      updated_at: "2026-01-04T00:00:00.000Z",
    }, {
      id: "saved-5",
      user_id: "user-1",
      place_id: "place-5",
      title: "Cafe Five",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Morjim" },
      created_at: "2026-01-05T00:00:00.000Z",
      updated_at: "2026-01-05T00:00:00.000Z",
    }, {
      id: "saved-6",
      user_id: "user-1",
      place_id: "place-6",
      title: "Walk One",
      category: "Explore",
      metadata_json: { city: "Goa", locality: "Calangute" },
      created_at: "2026-01-06T00:00:00.000Z",
      updated_at: "2026-01-06T00:00:00.000Z",
    }, {
      id: "saved-7",
      user_id: "user-1",
      place_id: "place-7",
      title: "Walk Two",
      category: "Explore",
      metadata_json: { city: "Goa", locality: "Candolim" },
      created_at: "2026-01-07T00:00:00.000Z",
      updated_at: "2026-01-07T00:00:00.000Z",
    }, {
      id: "saved-8",
      user_id: "user-1",
      place_id: "place-8",
      title: "Hotel One",
      category: "Stay",
      metadata_json: { city: "Goa", locality: "Panjim" },
      created_at: "2026-01-08T00:00:00.000Z",
      updated_at: "2026-01-08T00:00:00.000Z",
    }, {
      id: "saved-9",
      user_id: "user-1",
      place_id: "place-9",
      title: "Activity One",
      category: "Activity",
      metadata_json: { city: "Goa", locality: "Mapusa" },
      created_at: "2026-01-09T00:00:00.000Z",
      updated_at: "2026-01-09T00:00:00.000Z",
    }, {
      id: "saved-10",
      user_id: "user-1",
      place_id: "place-10",
      title: "Activity Two",
      category: "Activity",
      metadata_json: { city: "Goa", locality: "Arpora" },
      created_at: "2026-01-10T00:00:00.000Z",
      updated_at: "2026-01-10T00:00:00.000Z",
    }, {
      id: "saved-11",
      user_id: "user-1",
      place_id: "place-11",
      title: "Explore Three",
      category: "Explore",
      metadata_json: { city: "Goa", locality: "Baga" },
      created_at: "2026-01-11T00:00:00.000Z",
      updated_at: "2026-01-11T00:00:00.000Z",
    }, {
      id: "saved-12",
      user_id: "user-1",
      place_id: "place-12",
      title: "Explore Four",
      category: "Explore",
      metadata_json: { city: "Goa", locality: "Colva" },
      created_at: "2026-01-12T00:00:00.000Z",
      updated_at: "2026-01-12T00:00:00.000Z",
    },
  ]);

  assert.equal(response.status, 200);
  assert.equal(body.metadata?.rule, "taste_trail");
  assert.ok(Array.isArray(body.alternatives));
  assert.ok(body.alternatives.every((item: any) => item.cardKey !== body.cardKey));
  assert.equal(new Set(body.alternatives.map((item: any) => item.cardKey)).size, body.alternatives.length);
  assert.ok(body.alternatives.every((item: any) => item.metadata?.rule !== "dominant_category"));
});

test("hero card uses the most frequent representative locality instead of the first locality", async () => {
  const { response, body } = await fetchHeroCardForSavedPlaces([
    {
      id: "saved-1",
      user_id: "user-1",
      place_id: "place-1",
      title: "Cafe One",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Firsttown" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }, {
      id: "saved-2",
      user_id: "user-1",
      place_id: "place-2",
      title: "Cafe Two",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Indiranagar" },
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    }, {
      id: "saved-3",
      user_id: "user-1",
      place_id: "place-3",
      title: "Cafe Three",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Indiranagar" },
      created_at: "2026-01-03T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:00.000Z",
    }, {
      id: "saved-4",
      user_id: "user-1",
      place_id: "place-4",
      title: "Cafe Four",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Indiranagar" },
      created_at: "2026-01-04T00:00:00.000Z",
      updated_at: "2026-01-04T00:00:00.000Z",
    }, {
      id: "saved-5",
      user_id: "user-1",
      place_id: "place-5",
      title: "Cafe Five",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "HSR Layout" },
      created_at: "2026-01-05T00:00:00.000Z",
      updated_at: "2026-01-05T00:00:00.000Z",
    },
  ]);

  assert.equal(response.status, 200);
  assert.equal(body.metadata?.rule, "taste_trail");
  assert.equal(body.metadata?.targetLocality, "Indiranagar");
});

test("hero card can surface a meaningful secondary category as an alternative", async () => {
  const savedRows = [
    ...Array.from({ length: 25 }, (_, index) => ({
      id: `taste-${index + 1}`,
      user_id: "user-1",
      place_id: `taste-place-${index + 1}`,
      title: `Taste Place ${index + 1}`,
      category: "Taste",
      metadata_json: { city: "Goa", locality: index < 8 ? "Anjuna" : "Vagator" },
      created_at: `2026-02-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      updated_at: `2026-02-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    })),
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `explore-${index + 1}`,
      user_id: "user-1",
      place_id: `explore-place-${index + 1}`,
      title: `Explore Place ${index + 1}`,
      category: "Explore",
      metadata_json: { city: "Goa", locality: index < 10 ? "Calangute" : "Candolim" },
      created_at: `2026-03-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      updated_at: `2026-03-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `stay-${index + 1}`,
      user_id: "user-1",
      place_id: `stay-place-${index + 1}`,
      title: `Stay Place ${index + 1}`,
      category: "Stay",
      metadata_json: { city: "Goa", locality: "Panjim" },
      created_at: `2026-04-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      updated_at: `2026-04-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    })),
  ];
  const { response, body } = await fetchHeroCardForSavedPlaces(savedRows);

  assert.equal(response.status, 200);
  assert.equal(body.metadata?.rule, "taste_trail");
  assert.ok(Array.isArray(body.alternatives));
  assert.ok(body.alternatives.some((item: any) => item.metadata?.rule === "secondary_explore"));
});

test("matching ready Stroll adds canonical readyStrollId", async () => {
  const savedRows = [
    {
      id: "saved-1",
      user_id: "user-1",
      place_id: "place-1",
      title: "Cafe One",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Anjuna" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }, {
      id: "saved-2",
      user_id: "user-1",
      place_id: "place-2",
      title: "Cafe Two",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Vagator" },
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    }, {
      id: "saved-3",
      user_id: "user-1",
      place_id: "place-3",
      title: "Cafe Three",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Morjim" },
      created_at: "2026-01-03T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:00.000Z",
    }, {
      id: "saved-4",
      user_id: "user-1",
      place_id: "place-4",
      title: "Cafe Four",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Assagao" },
      created_at: "2026-01-04T00:00:00.000Z",
      updated_at: "2026-01-04T00:00:00.000Z",
    }, {
      id: "saved-5",
      user_id: "user-1",
      place_id: "place-5",
      title: "Cafe Five",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Siolim" },
      created_at: "2026-01-05T00:00:00.000Z",
      updated_at: "2026-01-05T00:00:00.000Z",
    },
  ];
  const { response, body } = await fetchHeroCardForSavedPlaces(savedRows, {
    readyStrollRows: [{
      id: "stroll-1",
      user_id: "user-1",
      city: "Goa",
      source: "hero",
      interests_json: ["Taste"],
      stop_place_ids_json: ["place-1", "place-2", "place-3"],
      stop_categories_json: ["Taste", "Taste", "Taste"],
    }],
  });

  assert.equal(response.status, 200);
  assert.equal(body.ctaAction, "build_food_trail");
  assert.equal(body.readyStrollId, "stroll-1");
  assert.equal(body.heroState, "ready_stroll");
});

test("no reliable ready Stroll match leaves readyStrollId absent", async () => {
  const savedRows = [
    {
      id: "saved-1",
      user_id: "user-1",
      place_id: "place-1",
      title: "Cafe One",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Anjuna" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }, {
      id: "saved-2",
      user_id: "user-1",
      place_id: "place-2",
      title: "Cafe Two",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Vagator" },
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    }, {
      id: "saved-3",
      user_id: "user-1",
      place_id: "place-3",
      title: "Cafe Three",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Morjim" },
      created_at: "2026-01-03T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:00.000Z",
    }, {
      id: "saved-4",
      user_id: "user-1",
      place_id: "place-4",
      title: "Cafe Four",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Assagao" },
      created_at: "2026-01-04T00:00:00.000Z",
      updated_at: "2026-01-04T00:00:00.000Z",
    }, {
      id: "saved-5",
      user_id: "user-1",
      place_id: "place-5",
      title: "Cafe Five",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Siolim" },
      created_at: "2026-01-05T00:00:00.000Z",
      updated_at: "2026-01-05T00:00:00.000Z",
    },
  ];
  const { response, body } = await fetchHeroCardForSavedPlaces(savedRows, {
    readyStrollRows: [{
      id: "stroll-2",
      user_id: "user-1",
      city: "Goa",
      source: "hero",
      interests_json: ["Taste"],
      stop_place_ids_json: ["place-1", "place-2", "outside-place"],
      stop_categories_json: ["Taste", "Taste", "Taste"],
    }],
  });

  assert.equal(response.status, 200);
  assert.equal(body.ctaAction, "build_food_trail");
  assert.equal("readyStrollId" in body, false);
  assert.equal(body.heroState, "suggestion");
});

test("hero ready Stroll lookup is scoped to authenticated user and ready status only", async () => {
  const { calls } = await fetchHeroCardForSavedPlaces([
    {
      id: "saved-1",
      user_id: "user-1",
      place_id: "place-1",
      title: "Cafe One",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Anjuna" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }, {
      id: "saved-2",
      user_id: "user-1",
      place_id: "place-2",
      title: "Cafe Two",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Vagator" },
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    }, {
      id: "saved-3",
      user_id: "user-1",
      place_id: "place-3",
      title: "Cafe Three",
      category: "Taste",
      metadata_json: { city: "Goa", locality: "Morjim" },
      created_at: "2026-01-03T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:00.000Z",
    },
  ]);

  const readyLookupCall = calls.find((call) => /from strolls s/i.test(call.sql) && /json_agg\(ss\.place_id/i.test(call.sql));
  assert.ok(readyLookupCall);
  assert.match(readyLookupCall?.sql || "", /where s\.user_id = \$1 and s\.status = 'ready'/i);
  assert.equal(readyLookupCall?.params?.[0], "user-1");
});

test("cross-user and category-mismatched ready Stroll rows are rejected", async () => {
  const savedRows = [
    {
      id: "saved-1",
      user_id: "user-1",
      place_id: "place-1",
      title: "Walk One",
      category: "Explore",
      metadata_json: { city: "Jaipur", locality: "Amer" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }, {
      id: "saved-2",
      user_id: "user-1",
      place_id: "place-2",
      title: "Walk Two",
      category: "Explore",
      metadata_json: { city: "Jaipur", locality: "Pink City" },
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    }, {
      id: "saved-3",
      user_id: "user-1",
      place_id: "place-3",
      title: "Walk Three",
      category: "Explore",
      metadata_json: { city: "Jaipur", locality: "Nahargarh" },
      created_at: "2026-01-03T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:00.000Z",
    }, {
      id: "saved-4",
      user_id: "user-1",
      place_id: "place-4",
      title: "Walk Four",
      category: "Explore",
      metadata_json: { city: "Jaipur", locality: "Bapu Nagar" },
      created_at: "2026-01-04T00:00:00.000Z",
      updated_at: "2026-01-04T00:00:00.000Z",
    }, {
      id: "saved-5",
      user_id: "user-1",
      place_id: "place-5",
      title: "Walk Five",
      category: "Explore",
      metadata_json: { city: "Jaipur", locality: "Jal Mahal" },
      created_at: "2026-01-05T00:00:00.000Z",
      updated_at: "2026-01-05T00:00:00.000Z",
    },
  ];
  const { response, body } = await fetchHeroCardForSavedPlaces(savedRows, {
    readyStrollRows: [
      {
        id: "stroll-cross-user",
        user_id: "user-2",
        city: "Jaipur",
        source: "hero",
        interests_json: ["Explore"],
        stop_place_ids_json: ["place-1", "place-2", "place-3"],
        stop_categories_json: ["Explore", "Explore", "Explore"],
      },
      {
        id: "stroll-category-mismatch",
        user_id: "user-1",
        city: "Jaipur",
        source: "hero",
        interests_json: ["Taste"],
        stop_place_ids_json: ["place-1", "place-2", "place-3"],
        stop_categories_json: ["Taste", "Taste", "Taste"],
      },
    ],
  });

  assert.equal(response.status, 200);
  assert.equal(body.ctaAction, "plan_weekend_explore");
  assert.equal("readyStrollId" in body, false);
  assert.equal(body.heroState, "suggestion");
});

test("city mismatch is rejected for city-plan hero matching", async () => {
  const savedRows = [
    {
      id: "saved-1",
      user_id: "user-1",
      place_id: "place-1",
      title: "Food One",
      category: "Taste",
      metadata_json: { city: "Jaipur", locality: "Amer" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }, {
      id: "saved-2",
      user_id: "user-1",
      place_id: "place-2",
      title: "Stay Two",
      category: "Stay",
      metadata_json: { city: "Jaipur", locality: "Pink City" },
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    }, {
      id: "saved-3",
      user_id: "user-1",
      place_id: "place-3",
      title: "Explore Three",
      category: "Explore",
      metadata_json: { city: "Jaipur", locality: "Nahargarh" },
      created_at: "2026-01-03T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:00.000Z",
    },
  ];
  const { response, body } = await fetchHeroCardForSavedPlaces(savedRows, {
    readyStrollRows: [{
      id: "stroll-city-mismatch",
      user_id: "user-1",
      city: "Goa",
      source: "hero",
      interests_json: ["Taste", "Explore"],
      stop_place_ids_json: ["place-1", "place-2", "place-3"],
      stop_categories_json: ["Taste", "Stay", "Explore"],
    }],
  });

  assert.equal(response.status, 200);
  assert.equal(body.ctaAction, "view_city_plan");
  assert.equal(body.metadata?.targetCity, "Jaipur");
  assert.equal("readyStrollId" in body, false);
  assert.equal(body.heroState, "suggestion");
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

test("admin usage overview requires authentication", async () => {
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
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/usage/overview`);
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.ok, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("admin usage overview forbids authenticated non-admin users", async () => {
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
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/usage/overview`, {
      headers: { Cookie: "wr_session=test-token" },
    });
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.ok, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("admin usage overview returns aggregated response shape for admin users", async () => {
  process.env.NODE_ENV = "test";
  process.env.ADMIN_EMAILS = "admin@example.com";
  const mock = createDatabaseMock([
    [buildAuthSessionUserRow({ email: "admin@example.com" })],
    [
      {
        actor_key: "u:user-1",
        user_type: "logged_in",
        first_seen_at: "2026-06-05T10:00:00Z",
        last_seen_at: "2026-06-21T10:00:00Z",
        runs_count: "3",
        unique_links_submitted: "2",
        saved_places_count: "2",
        edited_count: "1",
        reused_count: "1",
        app_opened_count: "1",
        login_seen_count: "1",
      },
      {
        actor_key: "a:anon-1",
        user_type: "anonymous",
        first_seen_at: "2026-05-28T10:00:00Z",
        last_seen_at: "2026-06-20T10:00:00Z",
        runs_count: "1",
        unique_links_submitted: "1",
        saved_places_count: "0",
        edited_count: "0",
        reused_count: "0",
        app_opened_count: "1",
        login_seen_count: "0",
      },
      {
        actor_key: "u:user-2",
        user_type: "logged_in",
        first_seen_at: "2026-06-10T10:00:00Z",
        last_seen_at: "2026-06-10T10:00:00Z",
        runs_count: "0",
        unique_links_submitted: "0",
        saved_places_count: "0",
        edited_count: "0",
        reused_count: "0",
        app_opened_count: "1",
        login_seen_count: "1",
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
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/usage/overview?from=2026-06-01&to=2026-06-21&platform=instagram&userType=logged_in&excludeTestUsers=true`, {
      headers: { Cookie: "wr_session=test-token" },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.summary.loggedInUsers, 2);
    assert.equal(body.summary.anonymousUsers, 1);
    assert.equal(body.summary.appOpenedUsers, 3);
    assert.equal(body.summary.loginSeenUsers, 2);
    assert.equal(body.summary.loggedInButNoRunUsers, 1);
    assert.equal(body.rates.saveRatePerUser, 0.5);
    assert.equal(body.activity.lastActiveAt, "2026-06-21T10:00:00Z");
    assert.equal(body.definitions.repeatUser, "runs_count >= 2");
    const usageSql = mock.calls.find((call) => call.sql.includes("run_rollup"))?.sql || "";
    assert.match(usageSql, /\(count\(distinct submitted_link_id\) filter \(where submitted_link_id is not null\)\)::numeric as unique_links_submitted/i);
    assert.match(usageSql, /\(count\(\*\) filter \(where final_user_action = 'edited'\)\)::numeric as edited_count/i);
    assert.match(usageSql, /\(count\(\*\) filter \(where event_type = 'app_opened'\)\)::numeric as app_opened_count/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("admin usage users returns paginated masked rows for admin users", async () => {
  process.env.NODE_ENV = "test";
  process.env.ADMIN_EMAILS = "admin@example.com";
  const mock = createDatabaseMock([
    [buildAuthSessionUserRow({ email: "admin@example.com" })],
    [
      {
        actor_key: "u:user-1",
        user_type: "logged_in",
        first_seen_at: "2026-06-05T10:00:00Z",
        last_seen_at: "2026-06-21T10:00:00Z",
        runs_count: "3",
        unique_links_submitted: "2",
        saved_places_count: "2",
        edited_count: "1",
        reused_count: "1",
        app_opened_count: "1",
        login_seen_count: "1",
      },
      {
        actor_key: "a:anon-1",
        user_type: "anonymous",
        first_seen_at: "2026-05-28T10:00:00Z",
        last_seen_at: "2026-06-20T10:00:00Z",
        runs_count: "1",
        unique_links_submitted: "1",
        saved_places_count: "0",
        edited_count: "0",
        reused_count: "0",
        app_opened_count: "1",
        login_seen_count: "0",
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
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/usage/users?from=2026-06-01&to=2026-06-21&userType=logged_in&status=repeat_user&q=usr_&page=1&pageSize=20&excludeTestUsers=false`, {
      headers: { Cookie: "wr_session=test-token" },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.pagination, {
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    assert.equal(body.rows.length, 1);
    assert.match(body.rows[0].actorKey, /^usr_[0-9a-f]{8}$/);
    assert.equal(body.rows[0].userType, "logged_in");
    assert.equal(body.rows[0].appOpenedCount, 1);
    assert.equal(body.rows[0].loginSeenCount, 1);
    assert.equal(body.rows[0].hasSubmittedLink, true);
    assert.equal(body.rows[0].hasSavedPlace, true);
    assert.ok(body.rows[0].statusBadges.includes("repeat_user"));
    assert.ok(body.rows[0].statusBadges.includes("saved_place"));
    assert.equal(JSON.stringify(body).includes("user-1"), false);
    assert.equal(JSON.stringify(body).includes("anon-1"), false);
    assert.equal(JSON.stringify(body).includes("admin@example.com"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("admin usage routes ignore blank and invalid optional filters safely", async () => {
  process.env.NODE_ENV = "test";
  process.env.ADMIN_EMAILS = "admin@example.com";
  const mock = createDatabaseMock([
    [buildAuthSessionUserRow({ email: "admin@example.com" })],
    [
      {
        actor_key: "u:user-1",
        user_type: "logged_in",
        first_seen_at: "2026-06-05T10:00:00Z",
        last_seen_at: "2026-06-21T10:00:00Z",
        runs_count: "1",
        unique_links_submitted: "1",
        saved_places_count: "0",
        edited_count: "0",
        reused_count: "0",
        app_opened_count: "1",
        login_seen_count: "1",
      },
    ],
    [buildAuthSessionUserRow({ email: "admin@example.com" })],
    [
      {
        actor_key: "u:user-1",
        user_type: "logged_in",
        first_seen_at: "2026-06-05T10:00:00Z",
        last_seen_at: "2026-06-21T10:00:00Z",
        runs_count: "1",
        unique_links_submitted: "1",
        saved_places_count: "0",
        edited_count: "0",
        reused_count: "0",
        app_opened_count: "1",
        login_seen_count: "1",
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
    const overviewResponse = await fetch(`http://127.0.0.1:${port}/api/admin/usage/overview?userType=&platform=%20%20&from=not-a-date&to=&excludeTestUsers=maybe`, {
      headers: { Cookie: "wr_session=test-token" },
    });
    const overviewBody = await overviewResponse.json();
    assert.equal(overviewResponse.status, 200);
    assert.equal(overviewBody.ok, true);

    const usersResponse = await fetch(`http://127.0.0.1:${port}/api/admin/usage/users?page=1&pageSize=20&userType=bad&status=bad&q=%20%20&from=bad-date&excludeTestUsers=bad`, {
      headers: { Cookie: "wr_session=test-token" },
    });
    const usersBody = await usersResponse.json();
    assert.equal(usersResponse.status, 200);
    assert.equal(usersBody.ok, true);
    assert.equal(usersBody.rows.length, 1);
    assert.deepEqual(mock.calls[1]?.params, [null, null, null, null]);
    assert.deepEqual(mock.calls[3]?.params, [null, null, null, null]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("app-event records app_opened", async () => {
  process.env.NODE_ENV = "test";
  const mock = createDatabaseMock([[]]);
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
    const response = await fetch(`http://127.0.0.1:${port}/api/analytics/app-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType: "app_opened", anonymousId: "anon-1" }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.recorded, true);
    assert.match(mock.calls[0]?.sql || "", /insert into app_usage_events/i);
    assert.equal(mock.calls[0]?.params?.[1], "app_opened");
    assert.equal(mock.calls[0]?.params?.[3], "anon-1");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("app-event records login_seen for logged-in session", async () => {
  process.env.NODE_ENV = "test";
  const mock = createDatabaseMock([
    [buildAuthSessionUserRow({ id: "user-1", email: "user@example.com" })],
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
    const response = await fetch(`http://127.0.0.1:${port}/api/analytics/app-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "wr_session=test-token" },
      body: JSON.stringify({ eventType: "login_seen", anonymousId: "anon-2" }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.recorded, true);
    assert.equal(mock.calls[1]?.params?.[1], "login_seen");
    assert.equal(mock.calls[1]?.params?.[2], "user-1");
    assert.equal(mock.calls[1]?.params?.[3], "anon-2");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("app-event rejects invalid event_type", async () => {
  process.env.NODE_ENV = "test";
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
    const response = await fetch(`http://127.0.0.1:${port}/api/analytics/app-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType: "something_else" }),
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("admin usage users includes app-event-only actors with no runs", async () => {
  process.env.NODE_ENV = "test";
  process.env.ADMIN_EMAILS = "admin@example.com";
  const mock = createDatabaseMock([
    [buildAuthSessionUserRow({ email: "admin@example.com" })],
    [
      {
        actor_key: "u:user-2",
        user_type: "logged_in",
        first_seen_at: "2026-06-10T10:00:00Z",
        last_seen_at: "2026-06-10T10:00:00Z",
        runs_count: "0",
        unique_links_submitted: "0",
        saved_places_count: "0",
        edited_count: "0",
        reused_count: "0",
        app_opened_count: "1",
        login_seen_count: "1",
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
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/usage/users?status=no_link_submitted`, {
      headers: { Cookie: "wr_session=test-token" },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.rows.length, 1);
    assert.equal(body.rows[0].runsCount, 0);
    assert.equal(body.rows[0].appOpenedCount, 1);
    assert.equal(body.rows[0].loginSeenCount, 1);
    assert.equal(body.rows[0].hasSubmittedLink, false);
    assert.equal(body.rows[0].hasSavedPlace, false);
    assert.ok(body.rows[0].statusBadges.includes("opened_app"));
    assert.ok(body.rows[0].statusBadges.includes("logged_in"));
    assert.ok(body.rows[0].statusBadges.includes("no_link_submitted"));
    assert.equal(JSON.stringify(body).includes("user-2"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

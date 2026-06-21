import test from "node:test";
import assert from "node:assert/strict";
import {
  __resetPostgresTestConfig,
  __setPostgresTestConfig,
  getAdminObservabilityOverview,
  getAdminObservabilityLinkDetail,
  getAdminObservabilityLinks,
  getAdminUsageOverview,
  getAdminUsageUsers,
  ensureAuthSchema,
  findSavedPlaceByUserAndPlaceId,
  getLatestReusableMetadataExtractionByCanonicalUrl,
  insertEntityFieldEdits,
  linkRunToSubmittedLink,
  updateAttemptPromotedFields,
  updateRunFinalOutcome,
  upsertAttemptEvidence,
  upsertAttemptStageRuns,
  upsertSubmittedLink,
} from "./postgresAuth";

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

test.afterEach(() => {
  __resetPostgresTestConfig();
});

test("ensureAuthSchema adds observability tables and promoted columns", async () => {
  const mock = createDatabaseMock();
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
    schemaReadyOverride: false,
  });

  await ensureAuthSchema();

  const sqlText = mock.calls.map((call) => call.sql).join("\n");
  assert.match(sqlText, /create table if not exists submitted_links/i);
  assert.match(sqlText, /create table if not exists attempt_stage_runs/i);
  assert.match(sqlText, /create table if not exists attempt_evidence/i);
  assert.match(sqlText, /create table if not exists entity_field_edits/i);
  assert.match(sqlText, /create table if not exists app_usage_events/i);
  assert.match(sqlText, /alter table if exists reel_analytics_runs add column if not exists submitted_link_id/i);
  assert.match(sqlText, /alter table if exists reel_analytics_runs add column if not exists canonical_url/i);
  assert.match(sqlText, /alter table if exists reel_analytics_attempts add column if not exists accepted_after/i);
  assert.match(sqlText, /alter table if exists reel_analytics_attempts add column if not exists stage_status_json/i);
  assert.match(sqlText, /alter table if exists reel_analytics_attempts add column if not exists visual_succeeded/i);
});

test("upsertSubmittedLink upserts by canonical url", async () => {
  const mock = createDatabaseMock([[{ id: "submitted-1" }]]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
  });

  const result = await upsertSubmittedLink({
    canonicalUrl: "https://instagram.com/p/example",
    canonicalUrlHash: "abc123",
    sourcePlatform: "instagram",
    latestTitle: "Title",
  });

  assert.equal(result?.id, "submitted-1");
  assert.match(mock.calls[0]?.sql || "", /insert into submitted_links/i);
  assert.deepEqual(mock.calls[0]?.params?.slice(1, 5), [
    "https://instagram.com/p/example",
    "abc123",
    "instagram",
    "Title",
  ]);
});

test("linkRunToSubmittedLink updates run linkage and canonical url", async () => {
  const mock = createDatabaseMock();
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
  });

  await linkRunToSubmittedLink({
    runId: "run-1",
    submittedLinkId: "submitted-1",
    canonicalUrl: "https://instagram.com/p/example",
  });

  assert.match(mock.calls[0]?.sql || "", /update reel_analytics_runs/i);
  assert.deepEqual(mock.calls[0]?.params, [
    "run-1",
    "submitted-1",
    "https://instagram.com/p/example",
  ]);
});

test("updateAttemptPromotedFields stores promoted attempt metadata", async () => {
  const mock = createDatabaseMock();
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
  });

  await updateAttemptPromotedFields({
    attemptId: "attempt-1",
    canonicalUrl: "https://instagram.com/p/example",
    acceptedAfter: "ocr",
    route: "attempt_1",
    stageStatus: { transcript: "partial" },
    stageTimingsMs: { transcript: 1200 },
    transcriptAttempted: true,
    transcriptSucceeded: false,
    ocrAttempted: true,
    ocrSucceeded: true,
    visualAttempted: false,
    visualSucceeded: false,
    commentsFetchedCount: 3,
    commentRepliesFetchedCount: 1,
    creatorReplyCount: 1,
  });

  const params = mock.calls[0]?.params || [];
  assert.match(mock.calls[0]?.sql || "", /update reel_analytics_attempts/i);
  assert.equal(params[0], "attempt-1");
  assert.equal(params[3], "https://instagram.com/p/example");
  assert.equal(params[4], "ocr");
  assert.equal(params[5], "attempt_1");
  assert.equal(params[6], JSON.stringify({ transcript: "partial" }));
  assert.equal(params[7], JSON.stringify({ transcript: 1200 }));
  assert.equal(params[10], true);
  assert.equal(params[11], true);
  assert.equal(params[14], 3);
});

test("upsertAttemptStageRuns writes one row per stage", async () => {
  const mock = createDatabaseMock();
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
  });

  await upsertAttemptStageRuns({
    runId: "run-1",
    attemptId: "attempt-1",
    attemptNumber: 2,
    stages: [
      { stageKey: "transcript", status: "partial", latencyMs: 20000, chars: 0 },
      { stageKey: "ocr", status: "success", latencyMs: 5000, chars: 42, metadataJson: { provider: "frame_ocr" } },
    ],
  });

  assert.equal(mock.calls.length, 2);
  assert.match(mock.calls[0]?.sql || "", /insert into attempt_stage_runs/i);
  assert.equal(mock.calls[0]?.params?.[4], "transcript");
  assert.equal(mock.calls[1]?.params?.[4], "ocr");
  assert.equal(mock.calls[1]?.params?.[10], JSON.stringify({ provider: "frame_ocr" }));
});

test("upsertAttemptEvidence writes one row per evidence item", async () => {
  const mock = createDatabaseMock();
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
  });

  await upsertAttemptEvidence({
    runId: "run-1",
    attemptId: "attempt-1",
    attemptNumber: 2,
    evidence: [
      {
        evidenceType: "comments",
        position: 0,
        summaryText: "Pinned comment mentions venue",
        metricsJson: { commentsFetchedCount: 3 },
      },
    ],
  });

  assert.equal(mock.calls.length, 1);
  assert.match(mock.calls[0]?.sql || "", /insert into attempt_evidence/i);
  assert.equal(mock.calls[0]?.params?.[4], "comments");
  assert.equal(mock.calls[0]?.params?.[8], JSON.stringify({ commentsFetchedCount: 3 }));
});

test("updateRunFinalOutcome and insertEntityFieldEdits are additive and idempotent-friendly", async () => {
  const mock = createDatabaseMock();
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
  });

  await updateRunFinalOutcome({
    runId: "run-1",
    finalUserAction: "saved",
    finalSelectedPlaceId: "place-123",
  });
  await insertEntityFieldEdits({
    edits: [
      {
        runId: "run-1",
        attemptId: "attempt-1",
        attemptNumber: 2,
        entityIndex: 0,
        fieldName: "name",
        beforeValue: "Old Cafe",
        afterValue: "New Cafe",
        editedByUserId: "user-1",
      },
    ],
  });

  assert.match(mock.calls[0]?.sql || "", /update reel_analytics_runs/i);
  assert.deepEqual(mock.calls[0]?.params, ["run-1", "saved", "place-123"]);
  assert.match(mock.calls[1]?.sql || "", /insert into entity_field_edits/i);
  assert.match(mock.calls[1]?.sql || "", /on conflict \(dedupe_key\) do nothing/i);
  assert.equal(mock.calls[1]?.params?.[7], "name");
  assert.equal(mock.calls[1]?.params?.[8], JSON.stringify("Old Cafe"));
  assert.equal(mock.calls[1]?.params?.[9], JSON.stringify("New Cafe"));
});

test("getLatestReusableMetadataExtractionByCanonicalUrl returns latest safe reusable extraction", async () => {
  const mock = createDatabaseMock([[
    {
      submitted_link_id: "submitted-1",
      canonical_url: "https://instagram.com/p/example",
      run_id: "run-1",
      client_run_id: "client-1",
      user_id: "user-1",
      anonymous_id: "anon-1",
      attempt_id: "attempt-2",
      attempt_number: 2,
      status: "queued",
      failure_reason: null,
      extraction_result_json: { canonicalUrl: "https://instagram.com/p/example", metadata: { canonicalUrl: "https://instagram.com/p/example" } },
      intelligence_status: "ready",
    },
  ]]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
  });

  const result = await getLatestReusableMetadataExtractionByCanonicalUrl("https://instagram.com/p/example");

  assert.equal(result?.submittedLinkId, "submitted-1");
  assert.equal(result?.runId, "run-1");
  assert.equal(result?.attemptNumber, 2);
  assert.equal(result?.priorStatus, "ready");
  assert.match(mock.calls[0]?.sql || "", /from submitted_links sl/i);
  assert.deepEqual(mock.calls[0]?.params, ["https://instagram.com/p/example"]);
});

test("findSavedPlaceByUserAndPlaceId returns existing saved place when present", async () => {
  const mock = createDatabaseMock([[
    {
      id: "saved-1",
      user_id: "user-1",
      place_id: "place-1",
      title: "Eva Cafe",
      category: "Taste",
      metadata_json: { locality: "Anjuna" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ]]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
  });

  const result = await findSavedPlaceByUserAndPlaceId("user-1", "place-1");

  assert.equal(result?.id, "saved-1");
  assert.equal(result?.placeId, "place-1");
  assert.deepEqual(mock.calls[0]?.params, ["user-1", "place-1"]);
});

test("getAdminObservabilityOverview returns aggregated overview metrics", async () => {
  const mock = createDatabaseMock([[
    {
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
    },
  ]]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
  });

  const result = await getAdminObservabilityOverview({
    from: "2026-06-01",
    to: "2026-06-21",
    platform: "instagram",
  });

  assert.equal(result.totalSubmittedLinks, 12);
  assert.equal(result.totalRuns, 10);
  assert.equal(result.totalAttempts, 14);
  assert.equal(result.savedRuns, 4);
  assert.equal(result.editedRuns, 2);
  assert.equal(result.discardedRuns, 1);
  assert.equal(result.saveRate, 0.4);
  assert.equal(result.editRate, 0.2);
  assert.equal(result.discardRate, 0.1);
  assert.equal(result.averageAttemptCount, 1.4);
  assert.equal(result.averageExtractionTimeMs, 8123.5);
  assert.equal(result.estimatedCacheReuseCount, 3);
  assert.equal(result.estimatedDuplicateSavedPlaceCount, 1);
  assert.deepEqual(mock.calls[0]?.params, ["2026-06-01", "2026-06-21", "instagram"]);
});

test("getAdminObservabilityLinkDetail returns nested chain and respects includeRaw", async () => {
  const mock = createDatabaseMock([
    // submitted link
    [
      {
        id: "submitted-1",
        canonical_url: "https://instagram.com/p/example",
        source_platform: "instagram",
        first_seen_at: "2026-06-01T10:00:00Z",
        last_seen_at: "2026-06-21T12:00:00Z",
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
        latest_attempt_number: 2,
        created_at: "2026-06-01T10:01:00Z",
        updated_at: "2026-06-01T10:05:00Z",
      },
      {
        id: "run-2",
        client_run_id: "client-2",
        user_id: null,
        anonymous_id: "anon-1",
        source_url: "https://instagram.com/p/example",
        source_platform: "instagram",
        latest_outcome: "started",
        latest_attempt_number: 0,
        created_at: "2026-06-02T11:00:00Z",
        updated_at: "2026-06-02T11:01:00Z",
      },
    ],
    // attempts
    [
      {
        id: "attempt-1",
        run_id: "run-1",
        attempt_number: 1,
        trigger_type: "manual",
        status: "completed",
        extraction_result_json: { some: "data" },
        intelligence_result_json: { out: "x" },
        created_at: "2026-06-01T10:02:00Z",
      },
      {
        id: "attempt-2",
        run_id: "run-1",
        attempt_number: 2,
        trigger_type: "retry",
        status: "completed",
        extraction_result_json: null,
        intelligence_result_json: null,
        created_at: "2026-06-01T10:03:00Z",
      },
    ],
    // stages
    [
      { id: "stage-1", run_id: "run-1", attempt_number: 1, stage: "extract", status: "completed", latency_ms: 120, created_at: "2026-06-01T10:02:10Z" },
    ],
    // evidence
    [
      { id: "e-1", run_id: "run-1", attempt_number: 1, evidence_type: "comments", summary_text: "ok", created_at: "2026-06-01T10:02:20Z" },
    ],
    // entities
    [
      { id: "ent-1", run_id: "run-1", attempt_id: null, attempt_number: 1, entity_index: 0, title: "Cafe", final_place_id: "place-1", was_saved: true, created_at: "2026-06-01T10:02:30Z" },
    ],
    // events
    [
      { id: "ev-1", run_id: "run-1", attempt_number: 1, event_name: "stage_started", payload_json: { ok: true }, created_at: "2026-06-01T10:02:05Z" },
    ],
    // edits
    [
      { id: "edit-1", dedupe_key: "k1", run_id: "run-1", attempt_id: null, attempt_number: 1, field_name: "title", before_value_json: '"Old"', after_value_json: '"New"', edited_by_user_id: "user-1", created_at: "2026-06-01T10:02:40Z" },
    ],
    // duplicated set for second call
    // submitted link
    [
      {
        id: "submitted-1",
        canonical_url: "https://instagram.com/p/example",
        source_platform: "instagram",
        first_seen_at: "2026-06-01T10:00:00Z",
        last_seen_at: "2026-06-21T12:00:00Z",
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
        latest_attempt_number: 2,
        created_at: "2026-06-01T10:01:00Z",
        updated_at: "2026-06-01T10:05:00Z",
      },
      {
        id: "run-2",
        client_run_id: "client-2",
        user_id: null,
        anonymous_id: "anon-1",
        source_url: "https://instagram.com/p/example",
        source_platform: "instagram",
        latest_outcome: "started",
        latest_attempt_number: 0,
        created_at: "2026-06-02T11:00:00Z",
        updated_at: "2026-06-02T11:01:00Z",
      },
    ],
    // attempts
    [
      {
        id: "attempt-1",
        run_id: "run-1",
        attempt_number: 1,
        trigger_type: "manual",
        status: "completed",
        extraction_result_json: { some: "data" },
        intelligence_result_json: { out: "x" },
        created_at: "2026-06-01T10:02:00Z",
      },
      {
        id: "attempt-2",
        run_id: "run-1",
        attempt_number: 2,
        trigger_type: "retry",
        status: "completed",
        extraction_result_json: null,
        intelligence_result_json: null,
        created_at: "2026-06-01T10:03:00Z",
      },
    ],
    // stages
    [
      { id: "stage-1", run_id: "run-1", attempt_number: 1, stage: "extract", status: "completed", latency_ms: 120, created_at: "2026-06-01T10:02:10Z" },
    ],
    // evidence
    [
      { id: "e-1", run_id: "run-1", attempt_number: 1, evidence_type: "comments", summary_text: "ok", created_at: "2026-06-01T10:02:20Z" },
    ],
    // entities
    [
      { id: "ent-1", run_id: "run-1", attempt_id: null, attempt_number: 1, entity_index: 0, title: "Cafe", final_place_id: "place-1", was_saved: true, created_at: "2026-06-01T10:02:30Z" },
    ],
    // events
    [
      { id: "ev-1", run_id: "run-1", attempt_number: 1, event_name: "stage_started", payload_json: { ok: true }, created_at: "2026-06-01T10:02:05Z" },
    ],
    // edits
    [
      { id: "edit-1", dedupe_key: "k1", run_id: "run-1", attempt_id: null, attempt_number: 1, field_name: "title", before_value_json: '"Old"', after_value_json: '"New"', edited_by_user_id: "user-1", created_at: "2026-06-01T10:02:40Z" },
    ],
  ]);

  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
  });

  const resultHidden = await getAdminObservabilityLinkDetail({ submittedLinkId: "submitted-1", includeRaw: false });
  assert.equal(resultHidden.submittedLink?.id, "submitted-1");
  assert.equal(resultHidden.runs.length, 2);
  // raw JSON should be hidden
  assert.equal(resultHidden.runs[0].attempts[0].extractionResult, null);

  const resultRaw = await getAdminObservabilityLinkDetail({ submittedLinkId: "submitted-1", includeRaw: true });
  assert.equal(resultRaw.runs[0].attempts[0].extractionResult.some, "data");
});


test("getAdminObservabilityLinks returns paginated list of submitted links with aggregates", async () => {
  const mock = createDatabaseMock([
    [{ total: "25" }], // count query result
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
  });

  const result = await getAdminObservabilityLinks({
    from: "2026-06-01",
    to: "2026-06-21",
    platform: "instagram",
    page: 1,
    pageSize: 50,
  });

  assert.equal(result.total, 25);
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 50);
  assert.equal(result.totalPages, 1);
  assert.equal(result.rows.length, 2);

  const firstRow = result.rows[0];
  assert.equal(firstRow.submittedLinkId, "link-1");
  assert.equal(firstRow.canonicalUrl, "https://instagram.com/p/abc123");
  assert.equal(firstRow.platform, "instagram");
  assert.equal(firstRow.runCount, 3);
  assert.equal(firstRow.attemptCount, 2);
  assert.equal(firstRow.cacheReuseCount, 2);
  assert.equal(firstRow.finalSelectedPlaceId, "place-456");
  assert.equal(firstRow.finalUserAction, "saved");
});

test("getAdminObservabilityLinks respects pagination limits", async () => {
  const mock = createDatabaseMock([
    [{ total: "250" }], // count query result
    [
      {
        submitted_link_id: "link-1",
        canonical_url: "https://example.com/1",
        platform: "website",
        first_seen_at: "2026-06-01T00:00:00Z",
        last_seen_at: "2026-06-01T00:00:00Z",
        run_count: "1",
        attempt_count: "1",
        latest_status: "completed",
        latest_accepted_after: null,
        latest_route: null,
        cache_reuse_count: "0",
        final_selected_place_id: null,
        final_user_action: null,
      },
    ],
  ]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
  });

  const result = await getAdminObservabilityLinks({
    page: 2,
    pageSize: 100,
  });

  assert.equal(result.total, 250);
  assert.equal(result.page, 2);
  assert.equal(result.pageSize, 100);
  assert.equal(result.totalPages, 3);
  // Verify offset calculation: (2 - 1) * 100 = 100
  assert.deepEqual(mock.calls[1]?.params?.[8], 100);
});

test("getAdminObservabilityLinks caps pageSize at 200", async () => {
  const mock = createDatabaseMock([
    [{ total: "0" }],
    [],
  ]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
  });

  const result = await getAdminObservabilityLinks({
    pageSize: 500, // requested 500, should be capped at 200
  });

  assert.equal(result.pageSize, 200);
});

test("getAdminObservabilityLinks defaults to page 1 and pageSize 50", async () => {
  const mock = createDatabaseMock([
    [{ total: "100" }],
    [],
  ]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
  });

  const result = await getAdminObservabilityLinks({});

  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 50);
  assert.equal(result.totalPages, 2);
});

test("getAdminObservabilityLinks filters by status", async () => {
  const mock = createDatabaseMock([
    [{ total: "5" }],
    [],
  ]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
  });

  await getAdminObservabilityLinks({
    status: "completed",
  });

  // Check that status is passed to the query
  assert.equal(mock.calls[0]?.params?.[3], "completed");
  assert.equal(mock.calls[1]?.params?.[3], "completed");
});

test("getAdminObservabilityLinks filters by reused flag", async () => {
  const mock = createDatabaseMock([
    [{ total: "10" }],
    [],
  ]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
  });

  await getAdminObservabilityLinks({
    reused: true,
  });

  // Check that reused flag is passed to the query
  assert.equal(mock.calls[0]?.params?.[4], true);
  assert.equal(mock.calls[1]?.params?.[4], true);
});

test("getAdminObservabilityLinks filters by acceptedAfter", async () => {
  const mock = createDatabaseMock([
    [{ total: "3" }],
    [],
  ]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
  });

  await getAdminObservabilityLinks({
    acceptedAfter: "ocr",
  });

  // Check that acceptedAfter is passed to the query
  assert.equal(mock.calls[0]?.params?.[5], "ocr");
  assert.equal(mock.calls[1]?.params?.[5], "ocr");
});

test("getAdminObservabilityLinks filters by search query (q)", async () => {
  const mock = createDatabaseMock([
    [{ total: "2" }],
    [],
  ]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
  });

  await getAdminObservabilityLinks({
    q: "instagram.com",
  });

  // Check that q is passed to the query
  assert.equal(mock.calls[0]?.params?.[6], "instagram.com");
  assert.equal(mock.calls[1]?.params?.[6], "instagram.com");
});

test("getAdminUsageOverview returns masked aggregate customer usage metrics", async () => {
  const mock = createDatabaseMock([[
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
  ]]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
  });

  const result = await getAdminUsageOverview({
    from: "2026-06-01",
    to: "2026-06-21",
    platform: "instagram",
  });

  assert.equal(result.loggedInUsers, 2);
  assert.equal(result.anonymousUsers, 1);
  assert.equal(result.uniqueUsers, 3);
  assert.equal(result.appOpenedUsers, 3);
  assert.equal(result.loginSeenUsers, 2);
  assert.equal(result.loggedInButNoRunUsers, 1);
  assert.equal(result.newUsers, 2);
  assert.equal(result.returningUsers, 1);
  assert.equal(result.repeatUsers, 1);
  assert.equal(result.usersSubmittedAtLeastOneLink, 2);
  assert.equal(result.usersSavedAtLeastOnePlace, 1);
  assert.equal(result.usersWithTwoPlusSavedPlaces, 1);
  assert.equal(result.usersSubmittedButDidNotSave, 1);
  assert.equal(result.totalSavedPlaces, 2);
  assert.equal(result.savesPerUser, 2 / 3);
  assert.equal(result.linksPerUser, 1);
  assert.equal(result.saveRatePerUser, 0.5);
  assert.equal(result.lastActiveAt, "2026-06-21T10:00:00Z");
  assert.deepEqual(mock.calls[0]?.params, ["2026-06-01", "2026-06-21", "instagram", null]);
});

test("getAdminUsageUsers paginates, filters, and masks actor keys", async () => {
  const mock = createDatabaseMock([[
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
  ]]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
  });

  const result = await getAdminUsageUsers({
    from: "2026-06-01",
    to: "2026-06-21",
    userType: "logged_in",
    status: "repeat_user",
    q: "usr_",
    page: 1,
    pageSize: 10,
  });

  assert.equal(result.total, 1);
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 10);
  assert.equal(result.totalPages, 1);
  assert.equal(result.rows.length, 1);
  assert.match(result.rows[0]?.actorKey || "", /^usr_[0-9a-f]{8}$/);
  assert.equal(result.rows[0]?.userType, "logged_in");
  assert.equal(result.rows[0]?.runsCount, 3);
  assert.equal(result.rows[0]?.uniqueLinksSubmitted, 2);
  assert.equal(result.rows[0]?.savedPlacesCount, 2);
  assert.equal(result.rows[0]?.editedCount, 1);
  assert.equal(result.rows[0]?.reusedCount, 1);
  assert.equal(result.rows[0]?.appOpenedCount, 1);
  assert.equal(result.rows[0]?.loginSeenCount, 1);
  assert.equal(result.rows[0]?.hasSubmittedLink, true);
  assert.equal(result.rows[0]?.hasSavedPlace, true);
  assert.equal(result.rows[0]?.saveRate, 1);
  assert.ok(result.rows[0]?.statusBadges.includes("repeat_user"));
  assert.ok(result.rows[0]?.statusBadges.includes("saved_place"));
  assert.ok(!result.rows[0]?.statusBadges.includes("no_link_submitted"));
  assert.ok(!JSON.stringify(result.rows[0]).includes("user-1"));
  assert.deepEqual(mock.calls[0]?.params, ["2026-06-01", "2026-06-21", null, "logged_in"]);
});

test("getAdminUsageUsers includes app event actors with no runs", async () => {
  const mock = createDatabaseMock([[
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
  ]]);
  __setPostgresTestConfig({
    databaseOverride: mock.db,
    databaseUrlOverride: "postgres://unit-test",
  });

  const result = await getAdminUsageUsers({
    userType: "logged_in",
    status: "no_link_submitted",
    page: 1,
    pageSize: 10,
  });

  assert.equal(result.total, 1);
  assert.equal(result.rows[0]?.runsCount, 0);
  assert.equal(result.rows[0]?.appOpenedCount, 1);
  assert.equal(result.rows[0]?.loginSeenCount, 1);
  assert.equal(result.rows[0]?.hasSubmittedLink, false);
  assert.equal(result.rows[0]?.hasSavedPlace, false);
  assert.ok(result.rows[0]?.statusBadges.includes("opened_app"));
  assert.ok(result.rows[0]?.statusBadges.includes("logged_in"));
  assert.ok(result.rows[0]?.statusBadges.includes("no_link_submitted"));
});

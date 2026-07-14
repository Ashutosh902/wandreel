/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StrollAdaptationPanel } from "./StrollAdaptationPanel";
import {
  acceptStrollAdaptation,
  fetchStrollAdaptationRecommendation,
  formatAdaptationEvidence,
  getAdaptationViewState,
  type StrollAdaptationRecommendation,
} from "./strollAdaptation";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function recommendation(overrides: Partial<Extract<StrollAdaptationRecommendation, { status: "recommended" }>> = {}): StrollAdaptationRecommendation {
  return {
    status: "recommended",
    originalStopIds: ["stop-1", "stop-2"],
    proposedStopIds: ["stop-2", "stop-1"],
    proposedSequence: [
      { stopId: "stop-2", placeId: "place-2", title: "Cafe", fromSequence: 2, toSequence: 1 },
      { stopId: "stop-1", placeId: "place-1", title: "Garden", fromSequence: 1, toSequence: 2 },
    ],
    reason: "Verified weather is active, so sheltered or indoor stops should be visited before outdoor stops.",
    evidence: [
      {
        type: "live_condition",
        provider: "open_meteo",
        conditionType: "weather",
        severity: "high",
        sourceTimestamp: "2026-07-11T10:00:00.000Z",
        expiryTimestamp: "2026-07-11T10:30:00.000Z",
        message: "Rain is reported near this Stroll.",
      },
      { type: "stop_suitability", stopId: "stop-2", stopTitle: "Cafe", weather: "indoor", openingHoursAvailable: true },
    ],
    confidence: "medium",
    limitations: ["Traffic, closures, and venue-access providers are not configured for this recommendation."],
    ...overrides,
  };
}

test("adaptation helpers classify dismiss and format evidence", () => {
  assert.equal(getAdaptationViewState({ loadState: "ready", recommendation: recommendation(), dismissed: false }), "recommended");
  assert.equal(getAdaptationViewState({ loadState: "ready", recommendation: recommendation(), dismissed: true }), "dismissed");
  assert.match(formatAdaptationEvidence(recommendation().evidence[0]), /Open Meteo checked weather/);
  assert.doesNotMatch(formatAdaptationEvidence(recommendation().evidence[0]), /2026-07-11T10:00:00/);
  assert.equal(
    formatAdaptationEvidence({ type: "current_location", latitude: 25.6123, longitude: 85.1432 }),
    "Your current location was available for route checks.",
  );
  assert.doesNotMatch(
    formatAdaptationEvidence({ type: "current_location", latitude: 25.6123, longitude: 85.1432 }),
    /25\.6123|85\.1432/,
  );
});

test("adaptation fetch and accept APIs use authenticated endpoints", async () => {
  const seen: Array<{ url: string; init?: RequestInit }> = [];
  const fetched = await fetchStrollAdaptationRecommendation("https://api.example.test/", "stroll 1", { lat: 25.6, lng: 85.1 }, async (url, init) => {
    seen.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ ok: true, recommendation: recommendation() }) };
  });
  const accepted = await acceptStrollAdaptation("https://api.example.test/", "stroll 1", ["stop-2", "stop-1"], async (url, init) => {
    seen.push({ url, init });
    assert.equal(init?.method, "POST");
    assert.equal(init?.body, JSON.stringify({ stopIds: ["stop-2", "stop-1"] }));
    return { ok: true, status: 200, json: async () => ({ ok: true, stroll: { id: "stroll-1", stops: [] } }) };
  });

  assert.equal(fetched.status, "recommended");
  assert.match(seen[0]?.url || "", /adaptation-recommendation\?currentLat=25\.6&currentLng=85\.1$/);
  assert.equal(seen[0]?.init?.credentials, "include");
  assert.match(seen[1]?.url || "", /\/api\/strolls\/stroll%201\/reorder$/);
  assert.equal(accepted.id, "stroll-1");
});

test("StrollAdaptationPanel renders proposed order and explicit actions", () => {
  const html = renderToStaticMarkup(
    <StrollAdaptationPanel
      loadState="ready"
      recommendation={recommendation()}
      error={null}
      dismissed={false}
      accepting={false}
      onAccept={() => undefined}
      onDismiss={() => undefined}
    />,
  );

  assert.match(html, /Route status/);
  assert.match(html, /Moderate confidence/);
  assert.doesNotMatch(html, /Route notes/);
  assert.match(html, /Cafe/);
  assert.match(html, /Was stop 2/);
  assert.match(html, /View route details/);
  assert.doesNotMatch(html, /What we checked/);
  assert.doesNotMatch(html, /Checked for this Stroll/);
  assert.doesNotMatch(html, /Still not included/);
  assert.doesNotMatch(html, /Evidence used/);
  assert.match(html, /Accept new order/);
  assert.match(html, /aria-label="Accept the proposed Stroll stop order"/);
  assert.match(html, /Keep current order/);
  assert.match(html, /aria-label="Keep the current Stroll order"/);
});

test("StrollAdaptationPanel renders no-recommendation fallback", () => {
  const none: StrollAdaptationRecommendation = {
    status: "none",
    originalStopIds: ["stop-1", "stop-2"],
    proposedStopIds: ["stop-1", "stop-2"],
    reason: "No reliable adaptation is available because live inputs are unavailable.",
    evidence: [],
    confidence: "low",
    limitations: ["Recommendation uses verified inputs only."],
  };
  const html = renderToStaticMarkup(
    <StrollAdaptationPanel
      loadState="ready"
      recommendation={none}
      error={null}
      dismissed={false}
      accepting={false}
      onAccept={() => undefined}
      onDismiss={() => undefined}
    />,
  );

  assert.match(html, /Route status/);
  assert.match(html, /No weather changes needed/);
  assert.match(html, /Limited live information/);
  assert.match(html, /Keep current order/);
  assert.doesNotMatch(html, /Accept new order/);
});

/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StrollLiveConditionsPanel } from "./StrollLiveConditionsPanel";
import {
  fetchStrollLiveConditions,
  filterCurrentLiveConditions,
  formatLiveFreshness,
  getLiveConditionsViewState,
  type PersistentLiveCondition,
  type PersistentStrollLiveConditions,
} from "./strollLiveConditions";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function condition(overrides: Partial<PersistentLiveCondition> = {}): PersistentLiveCondition {
  return {
    id: "condition-1",
    provider: "open_meteo",
    conditionType: "weather",
    severity: "moderate",
    confidence: null,
    sourceTimestamp: "2026-07-11T10:00:00.000Z",
    fetchedTimestamp: "2026-07-11T10:05:00.000Z",
    expiryTimestamp: "2026-07-11T10:35:00.000Z",
    message: "Rain is reported near this Stroll.",
    payload: { weatherCode: 61 },
    ...overrides,
  };
}

function live(overrides: Partial<PersistentStrollLiveConditions> = {}): PersistentStrollLiveConditions {
  return {
    strollId: "stroll-1",
    status: "available",
    fetchedTimestamp: "2026-07-11T10:05:00.000Z",
    expiryTimestamp: "2026-07-11T10:35:00.000Z",
    conditions: [],
    providers: [{
      provider: "open_meteo",
      conditionType: "weather",
      status: "success",
      fetchedTimestamp: "2026-07-11T10:05:00.000Z",
      expiryTimestamp: "2026-07-11T10:35:00.000Z",
      conditions: [],
    }],
    ...overrides,
  };
}

test("live condition helpers reject stale data and classify view state", () => {
  const now = new Date("2026-07-11T10:10:00.000Z");
  const current = condition();
  const stale = condition({ id: "stale", expiryTimestamp: "2026-07-11T10:09:00.000Z" });

  assert.deepEqual(filterCurrentLiveConditions([current, stale], now).map((item) => item.id), ["condition-1"]);
  assert.equal(getLiveConditionsViewState({ loadState: "ready", live: live({ conditions: [current] }), currentConditionCount: 1 }), "alerts");
  assert.equal(getLiveConditionsViewState({ loadState: "ready", live: live(), currentConditionCount: 0 }), "no-alerts");
  assert.equal(getLiveConditionsViewState({ loadState: "unavailable", live: null, currentConditionCount: 0 }), "unavailable");
  assert.equal(formatLiveFreshness("2026-07-11T10:05:00.000Z", now), "updated 5 min ago");
});

test("fetchStrollLiveConditions calls the authenticated live endpoint", async () => {
  let requestedUrl = "";
  const responseLive = live();
  const result = await fetchStrollLiveConditions("https://api.example.test/", "stroll 1", async (url, init) => {
    requestedUrl = url;
    assert.equal(init?.credentials, "include");
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, live: responseLive }),
    };
  });

  assert.equal(requestedUrl, "https://api.example.test/api/strolls/stroll%201/live-conditions");
  assert.equal(result.strollId, "stroll-1");
});

test("StrollLiveConditionsPanel renders verified alerts with source freshness", () => {
  const html = renderToStaticMarkup(
    <StrollLiveConditionsPanel
      loadState="ready"
      live={live({ conditions: [condition()] })}
      error={null}
      now={new Date("2026-07-11T10:10:00.000Z")}
    />,
  );

  assert.match(html, /Live conditions/);
  assert.match(html, /Rain is reported near this Stroll/);
  assert.match(html, /Open-Meteo/);
  assert.match(html, /updated 10 min ago/);
});

test("StrollLiveConditionsPanel renders no-alert and unavailable states without all-clear copy", () => {
  const noAlerts = renderToStaticMarkup(
    <StrollLiveConditionsPanel
      loadState="ready"
      live={live()}
      error={null}
      now={new Date("2026-07-11T10:10:00.000Z")}
    />,
  );
  const unavailable = renderToStaticMarkup(
    <StrollLiveConditionsPanel
      loadState="unavailable"
      live={live({
        status: "unavailable",
        providers: [{
          provider: "open_meteo",
          conditionType: "weather",
          status: "failed",
          fetchedTimestamp: "2026-07-11T10:05:00.000Z",
          expiryTimestamp: null,
          conditions: [],
          errorMessage: "Provider unavailable.",
        }],
      })}
      error={null}
      now={new Date("2026-07-11T10:10:00.000Z")}
    />,
  );

  assert.match(noAlerts, /No current verified alerts/);
  assert.doesNotMatch(noAlerts, /all clear/i);
  assert.match(unavailable, /Provider unavailable/);
});

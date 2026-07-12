/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StrollDraftEditorScreen } from "./StrollDraftEditorScreen";
import type { DraftStrollSeed, DraftStrollSummary } from "./strollOnboarding";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const baseSummary: DraftStrollSummary = {
  id: "stroll-1",
  name: "Patna Weekend Stroll",
  city: "Patna",
  status: "draft",
  source: "manual",
  stopCount: 0,
  createdAt: "2026-07-11T10:00:00.000Z",
  updatedAt: "2026-07-11T10:00:00.000Z",
};

const baseSeed: DraftStrollSeed = {
  name: baseSummary.name,
  city: baseSummary.city,
  startDate: "",
  endDate: "",
  requestedStartTime: "",
  travellerCount: 2,
  interests: ["Food"],
  latitude: null,
  longitude: null,
  placeIds: ["place-1"],
};

function renderEditor(summary: DraftStrollSummary = baseSummary) {
  return renderToStaticMarkup(
    <StrollDraftEditorScreen
      strollId={summary.id}
      seed={baseSeed}
      initialStrollSummary={summary}
      onBack={() => undefined}
      onStartStroll={() => undefined}
      onArchiveComplete={() => undefined}
    />,
  );
}

test("StrollDraftEditorScreen renders draft actions for editable Strolls", () => {
  const html = renderEditor();

  assert.match(html, /Stroll Draft/);
  assert.match(html, /Generate My Stroll/);
  assert.match(html, /Delete Draft/);
});

test("StrollDraftEditorScreen renders the start action for ready Strolls", () => {
  const html = renderEditor({ ...baseSummary, status: "ready", stopCount: 4 });

  assert.match(html, /Start Stroll/);
  assert.match(html, /Ready to start/);
});

/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StrollLibrarySection } from "./StrollLibrarySection";
import type { PersistentStrollSummary, StrollLibraryStatus } from "./strollLibrary";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function stroll(status: StrollLibraryStatus, overrides: Partial<PersistentStrollSummary> = {}): PersistentStrollSummary {
  return {
    id: `stroll-${status}`,
    name: `${status} Stroll`,
    description: null,
    city: "Patna",
    status,
    source: "manual",
    startDate: "2026-07-12",
    endDate: null,
    requestedStartTime: null,
    travellerCount: null,
    interests: [],
    latitude: null,
    longitude: null,
    totalDistanceMeters: null,
    estimatedDurationMinutes: null,
    stopCount: 2,
    failureCode: null,
    failureMessage: null,
    createdAt: "2026-07-11T10:00:00.000Z",
    updatedAt: "2026-07-11T10:00:00.000Z",
    curatedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function renderSection(overrides: Partial<React.ComponentProps<typeof StrollLibrarySection>> = {}) {
  return renderToStaticMarkup(
    <StrollLibrarySection
      strolls={[]}
      loadState="ready"
      error={null}
      retryingStrollId={null}
      archivingStrollId={null}
      onCreateStroll={() => undefined}
      onRetryStroll={() => undefined}
      onArchiveStroll={() => undefined}
      onOpenStroll={() => undefined}
      onStartStroll={() => undefined}
      {...overrides}
    />,
  );
}

test("StrollLibrarySection renders create-new plus card and empty state", () => {
  const html = renderSection();

  assert.match(html, /Create a New Stroll/);
  assert.match(html, /aria-label="Create a new Stroll draft"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /No Strolls yet/);
});

test("StrollLibrarySection renders loading and error states", () => {
  assert.match(renderSection({ loadState: "loading" }), /Loading Strolls/);
  assert.match(renderSection({ loadState: "error", error: "Network down" }), /Could not load Strolls/);
  assert.match(renderSection({ loadState: "error", error: "Network down" }), /Network down/);
});

test("StrollLibrarySection renders every active Stroll status", () => {
  const html = renderSection({
    strolls: [
      stroll("draft"),
      stroll("queued"),
      stroll("curating"),
      stroll("ready"),
      stroll("failed", { failureMessage: "Stop ownership failed" }),
    ],
  });

  assert.match(html, />Draft</);
  assert.match(html, />Queued</);
  assert.match(html, />Curating</);
  assert.match(html, />Ready</);
  assert.match(html, />Failed</);
  assert.match(html, /Manual/);
  assert.match(html, /role="button"/);
  assert.match(html, /aria-label="Open draft draft Stroll for editing"/);
  assert.match(html, /Continue Editing/);
  assert.match(html, /Delete Draft/);
  assert.match(html, /View Progress/);
  assert.match(html, /Start Stroll/);
  assert.match(html, />Retry</);
  assert.match(html, /aria-label="Retry curation for failed Stroll"/);
  assert.match(html, /Edit Inputs/);
  assert.match(html, /Stop ownership failed/);
});

test("StrollLibrarySection shows retry busy state", () => {
  const html = renderSection({
    retryingStrollId: "stroll-failed",
    strolls: [stroll("failed")],
  });

  assert.match(html, /Retrying.../);
  assert.match(html, /disabled=""/);
});

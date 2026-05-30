import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryIntelligenceJobStore } from "../jobStore";

test("async store creates and transitions job states", async () => {
  class FakeStore extends InMemoryIntelligenceJobStore {}
  const store = new FakeStore();

  const job = await store.create({
    source: {
      mode: "quick",
      metadata: {
        sourceUrl: "https://example.com",
        canonicalUrl: "https://example.com/",
        platform: "web",
        title: "Example",
        description: "",
        siteName: null,
        imageUrl: null,
        fetchedAtIso: new Date().toISOString(),
        provider: "html",
      },
      transcript: null,
      ocr: null,
      source: "https://example.com",
      platform: "web",
      canonicalUrl: "https://example.com/",
    },
  });

  assert.ok(["queued", "running"].includes(job.status));

  await new Promise((resolve) => setTimeout(resolve, 50));
  const latest = await store.get(job.id);
  assert.ok(latest);
  assert.ok(["running", "completed", "failed"].includes(latest!.status));
});

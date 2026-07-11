import test from "node:test";
import assert from "node:assert/strict";
import {
  createDraftStrollSchema,
  heroInteractionSchema,
  updateOnboardingSchema,
} from "./contracts";

test("createDraftStrollSchema applies defaults and normalizes arrays", () => {
  const parsed = createDraftStrollSchema.parse({
    clientRequestId: " request-1 ",
    source: "manual",
    city: " Patna ",
    travellerCount: 2,
    interests: [" Food ", "Food", "Heritage"],
    latitude: 25.5941,
    longitude: 85.1376,
    placeIds: ["place-1", "place-1", "place-2"],
  });

  assert.equal(parsed.clientRequestId, "request-1");
  assert.equal(parsed.name, "Patna Stroll");
  assert.deepEqual(parsed.interests, ["Food", "Heritage"]);
  assert.deepEqual(parsed.placeIds, ["place-1", "place-2"]);
});

test("createDraftStrollSchema rejects invalid source, coordinates, and oversized traveler count", () => {
  const parsed = createDraftStrollSchema.safeParse({
    clientRequestId: "request-1",
    source: "ai",
    city: "Patna",
    travellerCount: 21,
    latitude: 100,
    longitude: 85,
  });

  assert.equal(parsed.success, false);
});

test("updateOnboardingSchema accepts decisions but not unseen writes", () => {
  assert.equal(
    updateOnboardingSchema.safeParse({
      decision: "accepted",
      defaultTravellerCount: 2,
      defaultInterests: ["Food"],
      defaultStartTime: "10:30",
    }).success,
    true,
  );

  assert.equal(updateOnboardingSchema.safeParse({ decision: "unseen" }).success, false);
});

test("heroInteractionSchema constrains action names", () => {
  assert.equal(heroInteractionSchema.safeParse({ cardKey: "hero-1", action: "clicked" }).success, true);
  assert.equal(heroInteractionSchema.safeParse({ cardKey: "hero-1", action: "invented" }).success, false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { StrollReadyValidationError, validateStrollStopsForReady } from "./curationValidation";

test("validateStrollStopsForReady rejects missing ordered stops", () => {
  assert.throws(
    () => validateStrollStopsForReady([], []),
    (error) => error instanceof StrollReadyValidationError && error.code === "missing_stops",
  );
});

test("validateStrollStopsForReady rejects duplicate stop sequence", () => {
  assert.throws(
    () =>
      validateStrollStopsForReady(
        [
          { placeId: "place-1", sequence: 1 },
          { placeId: "place-2", sequence: 1 },
        ],
        ["place-1", "place-2"],
      ),
    (error) => error instanceof StrollReadyValidationError && error.code === "duplicate_stop_sequence",
  );
});

test("validateStrollStopsForReady rejects duplicate place in the same Stroll", () => {
  assert.throws(
    () =>
      validateStrollStopsForReady(
        [
          { placeId: "place-1", sequence: 1 },
          { placeId: "place-1", sequence: 2 },
        ],
        ["place-1"],
      ),
    (error) => error instanceof StrollReadyValidationError && error.code === "duplicate_stop_place",
  );
});

test("validateStrollStopsForReady rejects stops not owned by the user", () => {
  assert.throws(
    () =>
      validateStrollStopsForReady(
        [
          { placeId: "place-1", sequence: 1 },
          { placeId: "place-2", sequence: 2 },
        ],
        ["place-1"],
      ),
    (error) => error instanceof StrollReadyValidationError && error.code === "invalid_stop_ownership",
  );
});

test("validateStrollStopsForReady accepts unique owned stops", () => {
  assert.doesNotThrow(() =>
    validateStrollStopsForReady(
      [
        { placeId: "place-1", sequence: 1 },
        { placeId: "place-2", sequence: 2 },
      ],
      ["place-1", "place-2"],
    ),
  );
});

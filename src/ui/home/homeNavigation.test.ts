/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlannerUrlUpdate,
  getStrollDetailRoute,
  getPlannerPathname,
  getPlannerRouteFromPathname,
  getStrollIdFromPlannerRoute,
  type PlannerRoute,
} from "./homeNavigation";

test("getPlannerRouteFromPathname maps current compatibility paths to planner state", () => {
  assert.equal(getPlannerRouteFromPathname("/"), "home");
  assert.equal(getPlannerRouteFromPathname("/discover"), "home");
  assert.equal(getPlannerRouteFromPathname("/trail/food"), "food-trail");
  assert.equal(getPlannerRouteFromPathname("/trail/food/demo"), "food-trail");
  assert.equal(getPlannerRouteFromPathname("/plan/weekend"), "weekend-plan");
  assert.equal(getPlannerRouteFromPathname("/plan/weekend/preview"), "weekend-plan");
  assert.equal(getPlannerRouteFromPathname("/stroll/create"), "stroll-create");
  assert.equal(getPlannerRouteFromPathname("/stroll/create/manual"), "stroll-create");
  assert.equal(getPlannerRouteFromPathname("/stroll/stroll-1/edit"), "stroll-edit:stroll-1");
  assert.equal(getPlannerRouteFromPathname("/stroll/stroll-1"), "stroll-detail:stroll-1");
  assert.equal(getPlannerRouteFromPathname("/stroll/stroll%20with%20space"), "stroll-detail:stroll with space");
});

test("getPlannerPathname maps planner state back to current paths", () => {
  const cases: Array<[PlannerRoute, string]> = [
    ["home", "/"],
    ["food-trail", "/trail/food"],
    ["weekend-plan", "/plan/weekend"],
    ["stroll-create", "/stroll/create"],
    ["stroll-edit:stroll-1", "/stroll/stroll-1/edit"],
    ["stroll-detail:stroll-1", "/stroll/stroll-1"],
  ];

  for (const [route, pathname] of cases) {
    assert.equal(getPlannerPathname(route), pathname);
  }
});

test("Stroll detail route helpers preserve selected Stroll identity", () => {
  const route = getStrollDetailRoute("stroll/a b");

  assert.equal(route, "stroll-detail:stroll/a b");
  assert.equal(getStrollIdFromPlannerRoute(route), "stroll/a b");
  assert.equal(getPlannerPathname(route), "/stroll/stroll%2Fa%20b");
});

test("Stroll edit route helpers preserve selected Stroll identity", () => {
  const route = "stroll-edit:stroll/a b" as const;

  assert.equal(getStrollIdFromPlannerRoute(route), "stroll/a b");
  assert.equal(getPlannerPathname(route), "/stroll/stroll%2Fa%20b/edit");
});

test("buildPlannerUrlUpdate preserves query and hash when opening food trail", () => {
  const result = buildPlannerUrlUpdate("https://app.test/?demo=1&source=hero#saved", "food-trail", "demo");

  assert.equal(result.url.pathname, "/trail/food");
  assert.equal(result.url.search, "?demo=1&source=hero");
  assert.equal(result.url.hash, "#saved");
  assert.equal(result.historyPath, "/trail/food?demo=1&source=hero#saved");
});

test("buildPlannerUrlUpdate removes food demo query when returning home", () => {
  const result = buildPlannerUrlUpdate("https://app.test/trail/food?demo=1&source=hero#saved", "home", "demo");

  assert.equal(result.url.pathname, "/");
  assert.equal(result.url.search, "?source=hero");
  assert.equal(result.url.hash, "#saved");
  assert.equal(result.historyPath, "/?source=hero#saved");
});

test("buildPlannerUrlUpdate removes food demo query when opening weekend planner", () => {
  const result = buildPlannerUrlUpdate("https://app.test/trail/food?demo=1&source=hero#saved", "weekend-plan", "demo");

  assert.equal(result.url.pathname, "/plan/weekend");
  assert.equal(result.url.search, "?source=hero");
  assert.equal(result.url.hash, "#saved");
  assert.equal(result.historyPath, "/plan/weekend?source=hero#saved");
});

test("buildPlannerUrlUpdate removes food demo query when opening Stroll create", () => {
  const result = buildPlannerUrlUpdate("https://app.test/trail/food?demo=1&source=manual#saved", "stroll-create", "demo");

  assert.equal(result.url.pathname, "/stroll/create");
  assert.equal(result.url.search, "?source=manual");
  assert.equal(result.url.hash, "#saved");
  assert.equal(result.historyPath, "/stroll/create?source=manual#saved");
});

test("buildPlannerUrlUpdate preserves history continuity when opening a Stroll detail route", () => {
  const result = buildPlannerUrlUpdate("https://app.test/?source=hero#discover", "stroll-detail:ready-stroll", "demo");

  assert.equal(result.url.pathname, "/stroll/ready-stroll");
  assert.equal(result.url.search, "?source=hero");
  assert.equal(result.url.hash, "#discover");
  assert.equal(result.historyPath, "/stroll/ready-stroll?source=hero#discover");
});

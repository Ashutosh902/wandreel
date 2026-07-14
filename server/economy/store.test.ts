import test from "node:test";
import assert from "node:assert/strict";
import { allocateRewardMillis, computeContributionScore, economyConstants } from "./store";

test("signup and save constants use exact coin millis", () => {
  assert.equal(economyConstants.coinMillisPerCoin, 1000);
  assert.equal(economyConstants.initialLoginGrantMillis, 500_000);
  assert.equal(economyConstants.externalImportChargeMillis, 2_000);
  assert.equal(economyConstants.discoverSaveChargeMillis, 1_000);
  assert.equal(economyConstants.discoverRewardPoolMillis, 500);
});

test("500 recommenders split a 0.5 coin reward pool exactly", () => {
  const recommenders = Array.from({ length: 500 }, (_, index) => `user-${String(index + 1).padStart(3, "0")}`);
  const distribution = allocateRewardMillis(500, recommenders);

  assert.equal(distribution.length, 500);
  assert.equal(distribution.reduce((sum, reward) => sum + reward.amountMillis, 0), 500);
  assert.ok(distribution.every((reward) => reward.amountMillis === 1));
  assert.equal(new Set(distribution.map((reward) => reward.userId)).size, 500);
});

test("remainder allocation is deterministic and never creates value", () => {
  const distribution = allocateRewardMillis(500, ["charlie", "alice", "bob"]);

  assert.deepEqual(distribution.map((reward) => [reward.userId, reward.amountMillis, reward.remainderRank]), [
    ["alice", 167, 1],
    ["bob", 167, 2],
    ["charlie", 166, null],
  ]);
  assert.equal(distribution.reduce((sum, reward) => sum + reward.amountMillis, 0), 500);
});

test("late recommenders only participate in future snapshots", () => {
  const firstSnapshot = Array.from({ length: 500 }, (_, index) => `user-${String(index + 1).padStart(3, "0")}`);
  const laterRecommenders = Array.from({ length: 100 }, (_, index) => `late-${String(index + 1).padStart(3, "0")}`);

  const firstDistribution = allocateRewardMillis(500, firstSnapshot);
  const secondDistribution = allocateRewardMillis(500, [...firstSnapshot, ...laterRecommenders]);

  assert.equal(firstDistribution.length, 500);
  assert.equal(firstDistribution.some((reward) => reward.userId.startsWith("late-")), false);
  assert.equal(secondDistribution.length, 600);
  assert.equal(secondDistribution.filter((reward) => reward.userId.startsWith("late-")).length, 100);
  assert.equal(secondDistribution.reduce((sum, reward) => sum + reward.amountMillis, 0), 500);
});

test("duplicate recommendations count once in distribution", () => {
  const distribution = allocateRewardMillis(500, ["alice", "alice", "bob"]);

  assert.deepEqual(distribution.map((reward) => [reward.userId, reward.amountMillis]), [
    ["alice", 250],
    ["bob", 250],
  ]);
});

test("discover save conservation equation balances exactly", () => {
  const distribution = allocateRewardMillis(economyConstants.discoverRewardPoolMillis, ["alice", "bob", "charlie"]);
  const distributed = distribution.reduce((sum, reward) => sum + reward.amountMillis, 0);
  const platformRetention =
    economyConstants.discoverSaveChargeMillis - economyConstants.discoverRewardPoolMillis;

  assert.equal(distributed, 500);
  assert.equal(distributed + platformRetention, economyConstants.discoverSaveChargeMillis);
});

test("contribution score uses recommendations, saves, quality, and recency without wallet balance", () => {
  const score = computeContributionScore({
    placesRecommended: 25,
    communitySaves: 50,
    recentRecommendations: 5,
    recentCommunitySaves: 5,
  });

  assert.equal(score.score, 48);
  assert.equal(score.level, "Guide");
  assert.deepEqual(score.components, {
    recommendations: 15,
    communitySaves: 15,
    recommendationQuality: 8,
    recentActivity: 10,
  });
  assert.equal(score.formula.recommendationsWeight, 30);
  assert.equal(score.formula.communitySavesWeight, 30);
  assert.equal(score.formula.recommendationQualityWeight, 20);
  assert.equal(score.formula.recentActivityWeight, 20);
});

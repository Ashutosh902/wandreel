import { rejectExpiredConditions, type LiveCondition, type StrollLiveConditionsResponse } from "./liveIntelligence";
import type { StrollDetail, StrollStop } from "./types";

export type StrollAdaptationEvidence =
  | {
      type: "live_condition";
      provider: string;
      conditionType: string;
      severity: string;
      sourceTimestamp: string;
      expiryTimestamp: string;
      message: string;
    }
  | {
      type: "stop_suitability";
      stopId: string;
      stopTitle: string;
      weather: string;
      openingHoursAvailable: boolean;
    }
  | {
      type: "route_metric";
      stopId: string;
      routeDistanceMeters: number | null;
      routeDurationMinutes: number | null;
    }
  | {
      type: "time_context";
      currentTime: string;
      requestedStartTime: string | null;
    }
  | {
      type: "current_location";
      latitude: number;
      longitude: number;
    };

export type StrollAdaptationRecommendation =
  | {
      status: "recommended";
      originalStopIds: string[];
      proposedStopIds: string[];
      proposedSequence: Array<{
        stopId: string;
        placeId: string;
        title: string;
        fromSequence: number;
        toSequence: number;
      }>;
      reason: string;
      evidence: StrollAdaptationEvidence[];
      confidence: "low" | "medium" | "high";
      limitations: string[];
    }
  | {
      status: "none";
      originalStopIds: string[];
      proposedStopIds: string[];
      reason: string;
      evidence: StrollAdaptationEvidence[];
      confidence: "low";
      limitations: string[];
    };

export type StrollAdaptationContext = {
  now?: Date;
  liveConditions?: StrollLiveConditionsResponse | null;
  currentLocation?: { latitude: number; longitude: number } | null;
};

function stopTitle(stop: StrollStop) {
  return stop.placeTitle || stop.placeId || `Stop ${stop.sequence}`;
}

function isWeatherCondition(condition: LiveCondition) {
  return condition.conditionType === "weather" &&
    (condition.severity === "moderate" || condition.severity === "high" || condition.severity === "critical");
}

function weatherPriority(stop: StrollStop) {
  if (stop.suitability.weather === "indoor" || stop.suitability.weather === "sheltered") return 0;
  if (stop.suitability.weather === "unknown") return 1;
  return 2;
}

function hasSameOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function buildBaseEvidence(stroll: StrollDetail, now: Date, context: StrollAdaptationContext, conditions: LiveCondition[]) {
  const evidence: StrollAdaptationEvidence[] = [{
    type: "time_context",
    currentTime: now.toISOString(),
    requestedStartTime: stroll.requestedStartTime,
  }];
  if (context.currentLocation) {
    evidence.push({
      type: "current_location",
      latitude: context.currentLocation.latitude,
      longitude: context.currentLocation.longitude,
    });
  }
  for (const condition of conditions) {
    evidence.push({
      type: "live_condition",
      provider: condition.provider,
      conditionType: condition.conditionType,
      severity: condition.severity,
      sourceTimestamp: condition.sourceTimestamp,
      expiryTimestamp: condition.expiryTimestamp,
      message: condition.message,
    });
  }
  for (const stop of stroll.stops) {
    evidence.push({
      type: "stop_suitability",
      stopId: stop.id,
      stopTitle: stopTitle(stop),
      weather: stop.suitability.weather,
      openingHoursAvailable: Boolean(stop.suitability.openingHours),
    });
    if (stop.routeDistanceMeters != null || stop.routeDurationMinutes != null) {
      evidence.push({
        type: "route_metric",
        stopId: stop.id,
        routeDistanceMeters: stop.routeDistanceMeters,
        routeDurationMinutes: stop.routeDurationMinutes,
      });
    }
  }
  return evidence;
}

function noRecommendation(
  stroll: StrollDetail,
  reason: string,
  evidence: StrollAdaptationEvidence[],
  limitations: string[],
): StrollAdaptationRecommendation {
  const originalStopIds = stroll.stops.map((stop) => stop.id);
  return {
    status: "none",
    originalStopIds,
    proposedStopIds: originalStopIds,
    reason,
    evidence,
    confidence: "low",
    limitations,
  };
}

export function recommendStrollAdaptation(
  stroll: StrollDetail,
  context: StrollAdaptationContext = {},
): StrollAdaptationRecommendation {
  const now = context.now ?? new Date();
  const orderedStops = [...stroll.stops].sort((a, b) => a.sequence - b.sequence);
  const normalizedStroll = { ...stroll, stops: orderedStops };
  const originalStopIds = orderedStops.map((stop) => stop.id);
  const live = context.liveConditions;
  const currentConditions = live?.status === "available" ? rejectExpiredConditions(live.conditions, now) : [];
  const weatherConditions = currentConditions.filter(isWeatherCondition);
  const evidence = buildBaseEvidence(normalizedStroll, now, context, currentConditions);
  const limitations = [
    "Recommendation uses verified live weather and stored stop suitability only.",
    "Traffic, closures, and venue-access providers are not configured for this recommendation.",
  ];

  if (orderedStops.length < 2) {
    return noRecommendation(normalizedStroll, "No reliable adaptation is available because this Stroll has fewer than two stops.", evidence, limitations);
  }
  if (!live || live.status !== "available") {
    return noRecommendation(normalizedStroll, "No reliable adaptation is available because live inputs are unavailable.", evidence, limitations);
  }
  if (weatherConditions.length === 0) {
    return noRecommendation(normalizedStroll, "No reliable adaptation is available because there are no current verified weather alerts.", evidence, limitations);
  }

  const hasProtectedStop = orderedStops.some((stop) => weatherPriority(stop) === 0);
  const hasOutdoorStop = orderedStops.some((stop) => weatherPriority(stop) === 2);
  if (!hasProtectedStop || !hasOutdoorStop) {
    return noRecommendation(
      normalizedStroll,
      "No reliable adaptation is available because stored stop suitability is incomplete or does not support a safer order.",
      evidence,
      limitations,
    );
  }

  const proposedStops = [...orderedStops].sort((a, b) => {
    const priorityDiff = weatherPriority(a) - weatherPriority(b);
    return priorityDiff || a.sequence - b.sequence;
  });
  const proposedStopIds = proposedStops.map((stop) => stop.id);

  if (hasSameOrder(originalStopIds, proposedStopIds)) {
    return noRecommendation(normalizedStroll, "The current order already prioritizes sheltered stops for the verified weather input.", evidence, limitations);
  }

  const strongestSeverity = weatherConditions.some((condition) => condition.severity === "critical" || condition.severity === "high")
    ? "high"
    : "moderate";

  return {
    status: "recommended",
    originalStopIds,
    proposedStopIds,
    proposedSequence: proposedStops.map((stop, index) => ({
      stopId: stop.id,
      placeId: stop.placeId,
      title: stopTitle(stop),
      fromSequence: stop.sequence,
      toSequence: index + 1,
    })),
    reason: "Verified weather is active, so sheltered or indoor stops should be visited before outdoor stops.",
    evidence,
    confidence: strongestSeverity === "high" ? "medium" : "low",
    limitations,
  };
}

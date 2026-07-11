import type { StrollDetail } from "./types";

export type LiveConditionType =
  | "weather"
  | "traffic"
  | "closure"
  | "civic_alert"
  | "waterlogging"
  | "venue_access";

export type LiveConditionSeverity = "info" | "moderate" | "high" | "critical";

export type LiveProviderStatus = "success" | "unavailable" | "failed";

export type LiveCondition = {
  id: string;
  provider: string;
  conditionType: LiveConditionType;
  severity: LiveConditionSeverity;
  confidence: number | null;
  sourceTimestamp: string;
  fetchedTimestamp: string;
  expiryTimestamp: string;
  message: string;
  payload: Record<string, unknown>;
};

export type LiveProviderResult = {
  provider: string;
  conditionType: LiveConditionType;
  status: LiveProviderStatus;
  fetchedTimestamp: string;
  expiryTimestamp: string | null;
  conditions: LiveCondition[];
  errorCode?: string;
  errorMessage?: string;
};

export type StrollLiveConditionsResponse = {
  strollId: string;
  status: "available" | "unavailable";
  fetchedTimestamp: string;
  expiryTimestamp: string | null;
  conditions: LiveCondition[];
  providers: LiveProviderResult[];
};

export type LiveConditionProvider = {
  name: string;
  conditionType: LiveConditionType;
  fetch: (stroll: StrollDetail, now: Date) => Promise<LiveProviderResult>;
};

type CacheEntry = {
  expiresAtMs: number;
  response: StrollLiveConditionsResponse;
};

type OpenMeteoCurrentPayload = {
  time?: string;
  temperature_2m?: number;
  precipitation?: number;
  rain?: number;
  showers?: number;
  snowfall?: number;
  weather_code?: number;
  wind_speed_10m?: number;
  wind_gusts_10m?: number;
};

type OpenMeteoPayload = {
  current?: OpenMeteoCurrentPayload;
};

const LIVE_CACHE_TTL_MS = 10 * 60 * 1000;
const WEATHER_EXPIRY_MS = 30 * 60 * 1000;

function iso(date: Date) {
  return date.toISOString();
}

function addMs(date: Date, ms: number) {
  return new Date(date.getTime() + ms);
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstCoordinate(stroll: StrollDetail) {
  const stop = stroll.stops.find((item) => finiteNumber(item.latitude) !== null && finiteNumber(item.longitude) !== null);
  if (stop) return { latitude: Number(stop.latitude), longitude: Number(stop.longitude), label: stop.placeTitle || stop.placeId };
  if (finiteNumber(stroll.latitude) !== null && finiteNumber(stroll.longitude) !== null) {
    return { latitude: Number(stroll.latitude), longitude: Number(stroll.longitude), label: stroll.city };
  }
  return null;
}

function weatherCodeMessage(code: number | null) {
  if (code == null) return null;
  if (code >= 95) return { severity: "critical" as const, message: "Thunderstorm conditions are reported near this Stroll." };
  if (code >= 80) return { severity: "high" as const, message: "Rain showers are reported near this Stroll." };
  if (code >= 61) return { severity: "moderate" as const, message: "Rain is reported near this Stroll." };
  if (code >= 45 && code <= 48) return { severity: "moderate" as const, message: "Fog is reported near this Stroll." };
  return null;
}

function buildWeatherConditions(input: {
  provider: string;
  stroll: StrollDetail;
  coordinateLabel: string;
  current: OpenMeteoCurrentPayload;
  fetchedAt: Date;
  expiresAt: Date;
}) {
  const sourceTime = input.current.time ? new Date(input.current.time) : input.fetchedAt;
  const sourceTimestamp = Number.isFinite(sourceTime.getTime()) ? iso(sourceTime) : iso(input.fetchedAt);
  const weatherCode = finiteNumber(input.current.weather_code);
  const precipitation =
    finiteNumber(input.current.precipitation) ??
    finiteNumber(input.current.rain) ??
    finiteNumber(input.current.showers) ??
    finiteNumber(input.current.snowfall);
  const windSpeed = finiteNumber(input.current.wind_speed_10m);
  const windGusts = finiteNumber(input.current.wind_gusts_10m);
  const conditions: LiveCondition[] = [];
  const coded = weatherCodeMessage(weatherCode);

  if (coded) {
    conditions.push({
      id: `${input.provider}:${input.stroll.id}:weather-code`,
      provider: input.provider,
      conditionType: "weather",
      severity: coded.severity,
      confidence: null,
      sourceTimestamp,
      fetchedTimestamp: iso(input.fetchedAt),
      expiryTimestamp: iso(input.expiresAt),
      message: coded.message,
      payload: {
        weatherCode,
        location: input.coordinateLabel,
      },
    });
  }

  if (precipitation != null && precipitation >= 2) {
    conditions.push({
      id: `${input.provider}:${input.stroll.id}:precipitation`,
      provider: input.provider,
      conditionType: "weather",
      severity: precipitation >= 8 ? "high" : "moderate",
      confidence: null,
      sourceTimestamp,
      fetchedTimestamp: iso(input.fetchedAt),
      expiryTimestamp: iso(input.expiresAt),
      message: "Measurable precipitation is reported near this Stroll.",
      payload: {
        precipitationMm: precipitation,
        location: input.coordinateLabel,
      },
    });
  }

  if ((windGusts != null && windGusts >= 45) || (windSpeed != null && windSpeed >= 35)) {
    conditions.push({
      id: `${input.provider}:${input.stroll.id}:wind`,
      provider: input.provider,
      conditionType: "weather",
      severity: (windGusts ?? windSpeed ?? 0) >= 60 ? "high" : "moderate",
      confidence: null,
      sourceTimestamp,
      fetchedTimestamp: iso(input.fetchedAt),
      expiryTimestamp: iso(input.expiresAt),
      message: "Strong wind is reported near this Stroll.",
      payload: {
        windSpeedKmh: windSpeed,
        windGustsKmh: windGusts,
        location: input.coordinateLabel,
      },
    });
  }

  return conditions;
}

export function rejectExpiredConditions(conditions: LiveCondition[], now: Date) {
  return conditions.filter((condition) => {
    const expiryMs = Date.parse(condition.expiryTimestamp);
    return Number.isFinite(expiryMs) && expiryMs > now.getTime();
  });
}

export function createOpenMeteoWeatherProvider(fetcher: typeof fetch = fetch): LiveConditionProvider {
  return {
    name: "open_meteo",
    conditionType: "weather",
    async fetch(stroll, now) {
      const fetchedAt = now;
      const expiresAt = addMs(fetchedAt, WEATHER_EXPIRY_MS);
      const coordinate = firstCoordinate(stroll);
      if (!coordinate) {
        return {
          provider: "open_meteo",
          conditionType: "weather",
          status: "unavailable",
          fetchedTimestamp: iso(fetchedAt),
          expiryTimestamp: null,
          conditions: [],
          errorCode: "missing_coordinates",
          errorMessage: "Weather provider needs stored Stroll or stop coordinates.",
        };
      }

      const params = new URLSearchParams({
        latitude: String(coordinate.latitude),
        longitude: String(coordinate.longitude),
        current: "temperature_2m,precipitation,rain,showers,snowfall,weather_code,wind_speed_10m,wind_gusts_10m",
        wind_speed_unit: "kmh",
        timezone: "auto",
      });
      try {
        const response = await fetcher(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
        if (!response.ok) {
          return {
            provider: "open_meteo",
            conditionType: "weather",
            status: "failed",
            fetchedTimestamp: iso(fetchedAt),
            expiryTimestamp: null,
            conditions: [],
            errorCode: "provider_http_error",
            errorMessage: `Open-Meteo request failed (${response.status}).`,
          };
        }
        const payload = await response.json() as OpenMeteoPayload;
        const current = payload.current;
        if (!current) {
          return {
            provider: "open_meteo",
            conditionType: "weather",
            status: "unavailable",
            fetchedTimestamp: iso(fetchedAt),
            expiryTimestamp: null,
            conditions: [],
            errorCode: "missing_current_weather",
            errorMessage: "Open-Meteo did not return current weather.",
          };
        }

        return {
          provider: "open_meteo",
          conditionType: "weather",
          status: "success",
          fetchedTimestamp: iso(fetchedAt),
          expiryTimestamp: iso(expiresAt),
          conditions: buildWeatherConditions({
            provider: "open_meteo",
            stroll,
            coordinateLabel: coordinate.label,
            current,
            fetchedAt,
            expiresAt,
          }),
        };
      } catch (error) {
        return {
          provider: "open_meteo",
          conditionType: "weather",
          status: "failed",
          fetchedTimestamp: iso(fetchedAt),
          expiryTimestamp: null,
          conditions: [],
          errorCode: "provider_fetch_failed",
          errorMessage: error instanceof Error ? error.message : "Weather provider unavailable.",
        };
      }
    },
  };
}

export class StrollLiveIntelligenceService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly providers: LiveConditionProvider[];
  private readonly ttlMs: number;

  constructor(options: { providers?: LiveConditionProvider[]; ttlMs?: number } = {}) {
    this.providers = options.providers ?? [createOpenMeteoWeatherProvider()];
    this.ttlMs = options.ttlMs ?? LIVE_CACHE_TTL_MS;
  }

  async getLiveConditions(stroll: StrollDetail, now = new Date()): Promise<StrollLiveConditionsResponse> {
    const cacheKey = stroll.id;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAtMs > now.getTime()) {
      return {
        ...cached.response,
        conditions: rejectExpiredConditions(cached.response.conditions, now),
      };
    }

    const providerResults = await Promise.all(this.providers.map((provider) => provider.fetch(stroll, now)));
    const conditions = rejectExpiredConditions(providerResults.flatMap((result) => result.conditions), now);
    const expiryCandidates = providerResults
      .map((result) => result.expiryTimestamp ? Date.parse(result.expiryTimestamp) : null)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > now.getTime());
    const cacheExpiry = Math.min(now.getTime() + this.ttlMs, ...expiryCandidates);
    const response: StrollLiveConditionsResponse = {
      strollId: stroll.id,
      status: providerResults.some((result) => result.status === "success") ? "available" : "unavailable",
      fetchedTimestamp: iso(now),
      expiryTimestamp: expiryCandidates.length ? iso(new Date(Math.min(...expiryCandidates))) : null,
      conditions,
      providers: providerResults.map((result) => ({
        ...result,
        conditions: rejectExpiredConditions(result.conditions, now),
      })),
    };

    if (Number.isFinite(cacheExpiry) && cacheExpiry > now.getTime()) {
      this.cache.set(cacheKey, {
        expiresAtMs: cacheExpiry,
        response,
      });
    }

    return response;
  }

  clearCache() {
    this.cache.clear();
  }
}

export const strollLiveIntelligenceService = new StrollLiveIntelligenceService();

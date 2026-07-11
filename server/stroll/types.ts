export const strollSources = ["onboarding", "hero", "manual", "saved_places"] as const;
export const strollStatuses = ["draft", "queued", "curating", "ready", "failed", "archived"] as const;
export const onboardingDecisions = ["unseen", "accepted", "declined"] as const;
export const heroInteractionActions = [
  "exposed",
  "clicked",
  "bookmarked",
  "unbookmarked",
  "dismissed",
  "completed",
] as const;

export type StrollSource = (typeof strollSources)[number];
export type StrollStatus = (typeof strollStatuses)[number];
export type OnboardingDecision = (typeof onboardingDecisions)[number];
export type HeroInteractionAction = (typeof heroInteractionActions)[number];

export type StrollOnboardingPreference = {
  decision: OnboardingDecision;
  decisionAt: string | null;
  defaultTravellerCount: number | null;
  defaultInterests: string[];
  defaultStartTime: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type StrollSummary = {
  id: string;
  name: string;
  description: string | null;
  city: string;
  status: StrollStatus;
  source: StrollSource;
  startDate: string | null;
  endDate: string | null;
  requestedStartTime: string | null;
  travellerCount: number | null;
  interests: string[];
  latitude: number | null;
  longitude: number | null;
  totalDistanceMeters: number | null;
  estimatedDurationMinutes: number | null;
  stopCount: number;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  updatedAt: string;
  curatedAt: string | null;
  archivedAt: string | null;
};

export type StrollStop = {
  id: string;
  placeId: string;
  placeTitle: string | null;
  placeCategory: string | null;
  placeLocality: string | null;
  placeAddress: string | null;
  placeDescription: string | null;
  placeImageUrl: string | null;
  placeVideoUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  sequence: number;
  reason: string | null;
  generatedDescription: string | null;
  descriptionGenerationMeta: unknown | null;
  estimatedVisitDurationMinutes: number | null;
  arrivalEstimate: string | null;
  departureEstimate: string | null;
  routeDistanceMeters: number | null;
  routeDurationMinutes: number | null;
  suitability: {
    weather: "indoor" | "outdoor" | "sheltered" | "unknown";
    openingHours: unknown | null;
    notes: string[];
  };
};

export type StrollDetail = StrollSummary & {
  stops: StrollStop[];
};

export type HeroBookmark = {
  id: string;
  cardKey: string;
  heroType: string;
  ctaAction: string | null;
  title: string | null;
  subtitle: string | null;
  metadata: unknown;
  matchingPlaceIds: string[];
  createdAt: string;
  updatedAt: string;
};

import { z } from "zod";
import { heroInteractionActions, onboardingDecisions, strollSources } from "./types";

const trimmedString = (max: number) => z.string().trim().min(1).max(max);
const dateStringSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeStringSchema = z.string().trim().regex(/^\d{2}:\d{2}$/);

const stringListSchema = (maxItems: number, maxLength: number) =>
  z
    .array(z.string().trim().min(1).max(maxLength))
    .max(maxItems)
    .default([])
    .transform((values) => Array.from(new Set(values)));

const finiteCoordinateSchema = z.number().finite();

export const updateOnboardingSchema = z.object({
  decision: z.enum(onboardingDecisions).refine((value) => value !== "unseen", {
    message: "decision must be accepted or declined",
  }),
  defaultTravellerCount: z.number().int().min(1).max(20).optional().nullable(),
  defaultInterests: stringListSchema(10, 60).optional(),
  defaultStartTime: timeStringSchema.optional().nullable(),
});

export const createDraftStrollSchema = z
  .object({
    clientRequestId: trimmedString(160),
    source: z.enum(strollSources),
    name: trimmedString(160).optional(),
    city: trimmedString(120),
    startDate: dateStringSchema.optional().nullable(),
    endDate: dateStringSchema.optional().nullable(),
    requestedStartTime: timeStringSchema.optional().nullable(),
    travellerCount: z.number().int().min(1).max(20).optional().nullable(),
    interests: stringListSchema(10, 60).optional(),
    latitude: finiteCoordinateSchema.min(-90).max(90).optional().nullable(),
    longitude: finiteCoordinateSchema.min(-180).max(180).optional().nullable(),
    placeIds: stringListSchema(30, 200).optional(),
  })
  .transform((value) => ({
    ...value,
    name: value.name ?? `${value.city} Stroll`,
    interests: value.interests ?? [],
    placeIds: value.placeIds ?? [],
  }));

export const updateDraftStrollSchema = z
  .object({
    updatedAt: z.string().trim().datetime().optional().nullable(),
    name: trimmedString(160).optional(),
    city: trimmedString(120).optional(),
    startDate: dateStringSchema.optional().nullable(),
    endDate: dateStringSchema.optional().nullable(),
    requestedStartTime: timeStringSchema.optional().nullable(),
    travellerCount: z.number().int().min(1).max(20).optional().nullable(),
    interests: stringListSchema(10, 60).optional(),
    latitude: finiteCoordinateSchema.min(-90).max(90).optional().nullable(),
    longitude: finiteCoordinateSchema.min(-180).max(180).optional().nullable(),
    placeIds: stringListSchema(30, 200).optional(),
  })
  .transform((value) => ({
    ...value,
    interests: value.interests ?? [],
    placeIds: value.placeIds ?? [],
  }));

export const heroBookmarkSchema = z.object({
  cardKey: trimmedString(200),
  heroType: trimmedString(80).default("city_category_insight"),
  ctaAction: z.string().trim().max(80).optional().nullable(),
  title: z.string().trim().max(240).optional().nullable(),
  subtitle: z.string().trim().max(500).optional().nullable(),
  metadata: z.unknown().optional(),
  matchingPlaceIds: stringListSchema(30, 200).optional(),
});

export const removeHeroBookmarkSchema = z.object({
  cardKey: trimmedString(200),
});

export const heroInteractionSchema = z.object({
  cardKey: trimmedString(200),
  heroType: z.string().trim().max(80).optional().nullable(),
  action: z.enum(heroInteractionActions),
  metadata: z.unknown().optional(),
});

export const acceptStrollOrderSchema = z.object({
  stopIds: z.array(trimmedString(120)).min(1).max(30),
}).superRefine((value, ctx) => {
  if (new Set(value.stopIds).size !== value.stopIds.length) {
    ctx.addIssue({
      code: "custom",
      path: ["stopIds"],
      message: "stopIds cannot contain duplicates",
    });
  }
});

export type UpdateOnboardingInput = z.infer<typeof updateOnboardingSchema>;
export type CreateDraftStrollInput = z.infer<typeof createDraftStrollSchema>;
export type UpdateDraftStrollInput = z.infer<typeof updateDraftStrollSchema>;
export type HeroBookmarkInput = z.infer<typeof heroBookmarkSchema>;
export type RemoveHeroBookmarkInput = z.infer<typeof removeHeroBookmarkSchema>;
export type HeroInteractionInput = z.infer<typeof heroInteractionSchema>;
export type AcceptStrollOrderInput = z.infer<typeof acceptStrollOrderSchema>;

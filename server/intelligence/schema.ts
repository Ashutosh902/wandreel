import { z } from "zod";
import { INTENT_L1_VALUES, SOURCE_PLATFORMS, SOURCE_TYPES, SUPPORTED_CATEGORIES } from "./types";

const categorySchema = z.enum(SUPPORTED_CATEGORIES);
const confidenceSchema = z.enum(["high", "medium", "low"]);
const intentSchema = z.object({
  l1: z.enum(INTENT_L1_VALUES),
  l2: z.string().min(1),
  l3: z.array(z.string().min(1)).max(3),
});

export const tinyCaptionOutputSchema = z.object({
  status: z.enum(["ready", "needs_review", "no_supported_entity_found"]),
  entities: z.array(z.object({
    name: z.string().min(1),
    category: categorySchema,
    intent: intentSchema.optional(),
    locality: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    country: z.string().nullable(),
    confidence: z.enum(["high", "medium", "low"]),
    googleMapsQuery: z.string().nullable(),
    evidenceText: z.string().nullable(),
  })),
  weakMentions: z.array(z.object({
    text: z.string().min(1),
    reason: z.string().min(1),
  })).default([]),
});

export const intelligenceOutputSchema = z.object({
  source: z.object({
    url: z.string().nullable(),
    platform: z.enum(SOURCE_PLATFORMS),
    title: z.string().nullable(),
    creator: z.string().nullable(),
    sourceType: z.enum(SOURCE_TYPES),
  }),
  placeCollections: z.array(z.object({
    name: z.string().min(1),
    type: z.enum(["city", "locality", "region", "country", "unknown"]),
    city: z.string().nullable(),
    state: z.string().nullable(),
    country: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  })),
  categoriesPresent: z.array(categorySchema),
  weakMentions: z.array(
    z.object({
      text: z.string().min(1),
      reason: z.string().min(1),
    }),
  ),
  showIn: z.object({
    eat: z.boolean(),
    do: z.boolean(),
    stay: z.boolean(),
    see: z.boolean(),
  }),
  structuredEntities: z.array(z.object({
    name: z.string().min(1),
    category: categorySchema,
    locality: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    country: z.string().nullable(),
    address: z.string().nullable(),
    placeId: z.string().nullable().optional(),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    resolvedBy: z.enum(["google_maps", "none"]).optional(),
    resolutionConfidence: confidenceSchema.optional(),
    confidence: confidenceSchema,
    googleMapsQuery: z.string().nullable(),
    evidenceText: z.string().nullable(),
    intent: intentSchema.optional(),
  })),
  entities: z.array(z.object({
    category: categorySchema,
    name: z.string().min(1),
    entityType: z.string().min(1),
    city: z.string().nullable(),
    state: z.string().nullable(),
    country: z.string().nullable(),
    locality: z.string().nullable(),
    tags: z.array(z.string()),
    details: z.record(z.string(), z.unknown()),
    level2: z.union([
      z.object({
        category: z.literal("eat"),
        cuisineType: z.string().nullable(),
        mealType: z.string().nullable(),
        dietaryTags: z.array(z.string()),
        vibeTags: z.array(z.string()),
        priceTier: z.string().nullable(),
      }),
      z.object({
        category: z.literal("do"),
        activityType: z.string().nullable(),
        timeTag: z.string().nullable(),
        audienceTags: z.array(z.string()),
        vibeTags: z.array(z.string()),
        priceTier: z.string().nullable(),
      }),
      z.object({
        category: z.literal("stay"),
        stayType: z.string().nullable(),
        useCase: z.string().nullable(),
        amenities: z.array(z.string()),
        locationTags: z.array(z.string()),
        priceTier: z.string().nullable(),
      }),
      z.object({
        category: z.literal("see"),
        placeType: z.string().nullable(),
        experienceTag: z.string().nullable(),
        vibeTags: z.array(z.string()),
        entryFeeSignal: z.string().nullable(),
      }),
    ]),
    googleMapsQuery: z.string().nullable(),
    sourceEvidence: z.string().min(1),
    confidence: confidenceSchema,
    intent: intentSchema.optional(),
  })),
  visibility: z.object({
    showIn: z.array(z.string()),
    doNotShowIn: z.array(z.string()),
    reason: z.string().nullable(),
  }),
  status: z.enum(["ready", "needs_review", "no_supported_entity_found"]),
});

export function formatZodErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`);
}

import { z } from "zod";
import { SOURCE_PLATFORMS, SOURCE_TYPES, SUPPORTED_CATEGORIES } from "./types";

const categorySchema = z.enum(SUPPORTED_CATEGORIES);

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
  weakMentions: z.array(categorySchema),
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
    googleMapsQuery: z.string().nullable(),
    sourceEvidence: z.string().min(1),
    confidence: z.number().min(0).max(1),
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

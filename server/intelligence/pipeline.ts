import { intelligenceOutputSchema, formatZodErrors } from "./schema";
import type { IntelligencePipelineResult, IntelligenceRequest } from "./types";
import { normalizeIntelligenceOutput } from "./normalize";
import { callOpenAiStructuredExtraction } from "./providers/openai";

export async function runIntelligencePipeline(req: IntelligenceRequest): Promise<IntelligencePipelineResult> {
  const raw = await callOpenAiStructuredExtraction(req.source);
  const firstPass = intelligenceOutputSchema.safeParse(raw);
  if (firstPass.success) {
    return { output: firstPass.data, validationErrors: [], fixed: false };
  }

  const normalized = normalizeIntelligenceOutput(raw);
  const secondPass = intelligenceOutputSchema.safeParse(normalized);

  if (secondPass.success) {
    return {
      output: secondPass.data,
      validationErrors: formatZodErrors(firstPass.error),
      fixed: true,
    };
  }

  return {
    output: {
      ...normalized,
      status: "needs_review",
      visibility: {
        ...normalized.visibility,
        reason: "Schema validation failed after auto-fix. Manual review required.",
      },
    },
    validationErrors: [
      ...formatZodErrors(firstPass.error),
      ...formatZodErrors(secondPass.error),
    ],
    fixed: true,
  };
}

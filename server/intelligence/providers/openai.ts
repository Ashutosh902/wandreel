import OpenAI from "openai";
import type { ExtractionResult } from "../../extraction/types";
import { buildSystemPrompt, buildUserPrompt } from "../prompts";

export type OpenAiExtractionResult = {
  raw: unknown;
  timingsMs: {
    provider: number;
  };
  providerMeta: {
    model: string;
  };
};

function getClient(): OpenAI {
  const apiKey = String(process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for intelligence extraction");
  }

  const baseURL = String(process.env.OPENAI_BASE_URL || process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "").trim() || undefined;
  return new OpenAI({ apiKey, baseURL });
}

function extractResponseText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const chunks = Array.isArray(payload?.output) ? payload.output : [];
  const parts: string[] = [];
  for (const item of chunks) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      const text = typeof part?.text === "string" ? part.text : typeof part?.output_text === "string" ? part.output_text : "";
      if (text.trim()) parts.push(text.trim());
    }
  }
  return parts.join("\n").trim();
}

export async function callOpenAiStructuredExtraction(source: ExtractionResult): Promise<OpenAiExtractionResult> {
  const client = getClient();
  const model = process.env.INTELLIGENCE_MODEL || "gpt-5-nano";

  const startedAt = Date.now();
  const response = await client.responses.create({
    model,
    input: [
      { role: "system", content: [{ type: "input_text", text: buildSystemPrompt() }] },
      { role: "user", content: [{ type: "input_text", text: buildUserPrompt(source) }] },
    ],
    text: {
      format: {
        type: "json_object",
      },
    },
  });
  const providerMs = Date.now() - startedAt;

  const rawText = extractResponseText(response as any);
  if (!rawText) {
    return {
      raw: null,
      timingsMs: { provider: providerMs },
      providerMeta: { model },
    };
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = null;
  }

  return {
    raw: parsed,
    timingsMs: { provider: providerMs },
    providerMeta: { model },
  };
}

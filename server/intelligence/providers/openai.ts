import OpenAI from "openai";
import type { ExtractionResult } from "../../extraction/types";
import { buildSystemPrompt, buildUserPrompt } from "../prompts";

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

export async function callOpenAiStructuredExtraction(source: ExtractionResult): Promise<unknown> {
  const client = getClient();
  const model = process.env.INTELLIGENCE_MODEL || "gpt-5-nano";

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

  const rawText = extractResponseText(response as any);
  if (!rawText) return null;
  try {
    return JSON.parse(rawText);
  } catch {
    return null;
  }
}

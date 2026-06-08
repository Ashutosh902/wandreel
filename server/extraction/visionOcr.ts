import OpenAI from "openai";
import type { ScreenshotAsset } from "./types";

function getClient(): OpenAI | null {
  const apiKey = String(process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "").trim();
  if (!apiKey) return null;

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

export async function extractVisionOcr(imageUrl: string): Promise<{ text: string; reason: string | null }> {
  const client = getClient();
  if (!client) {
    return { text: "", reason: "openai_api_key_missing" };
  }

  try {
    const response = await client.responses.create({
      model: process.env.EXTRACTION_VISION_MODEL || process.env.INTELLIGENCE_MODEL || "gpt-5-nano",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Extract all visible text from this image. Return only the text you can read. If there is no readable text, return an empty response.",
            },
            {
              type: "input_image",
              image_url: imageUrl,
              detail: "low",
            },
          ],
        },
      ],
    });

    const text = extractResponseText(response as any).trim();
    return {
      text,
      reason: text ? null : "vision_ocr_empty",
    };
  } catch (error) {
    return {
      text: "",
      reason: error instanceof Error ? `vision_ocr_failed:${error.message}` : "vision_ocr_failed",
    };
  }
}

export async function extractVisionOcrFromScreenshots(screenshots: ScreenshotAsset[]): Promise<{ text: string; reason: string | null }> {
  const client = getClient();
  if (!client) {
    return { text: "", reason: "openai_api_key_missing" };
  }
  if (!screenshots.length) {
    return { text: "", reason: "no_screenshots_available" };
  }

  try {
    const response = await client.responses.create({
      model: process.env.EXTRACTION_VISION_MODEL || process.env.INTELLIGENCE_MODEL || "gpt-5-nano",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Extract all visible text from these screenshots. Merge repeated text once. " +
                "Prioritize place names, menu text, city names, addresses, price clues, signboards, and notable labels. " +
                "Return only the readable text. If nothing useful is visible, return an empty response.",
            },
            ...screenshots.slice(0, 4).map((shot) => ({
              type: "input_image" as const,
              image_url: shot.url,
              detail: "low" as const,
            })),
          ],
        },
      ],
    });

    const text = extractResponseText(response as any).trim();
    return {
      text,
      reason: text ? null : "vision_ocr_empty",
    };
  } catch (error) {
    return {
      text: "",
      reason: error instanceof Error ? `vision_ocr_failed:${error.message}` : "vision_ocr_failed",
    };
  }
}

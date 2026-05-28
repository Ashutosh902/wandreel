import type { ExtractedMetadata } from "./types";
import { runPythonJsonScript } from "./pythonRunner";
import { assertSafeHost, canonicalizeUrl, detectSourcePlatform } from "./url";

function pickMeta(html: string, key: string, attr: "property" | "name" = "property"): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<meta[^>]*${attr}=["']${escapedKey}["'][^>]*content=["']([^"']*)["'][^>]*>`, "i");
  return String(html.match(re)?.[1] || "").trim();
}

function pickTitle(html: string): string {
  return String(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();
}

function toAbsoluteUrl(baseUrl: string, input: string): string | null {
  const value = String(input || "").trim();
  if (!value) return null;
  try { return new URL(value, baseUrl).toString(); } catch { return null; }
}

async function extractViaHtml(canonicalUrl: string, sourceUrl: string): Promise<ExtractedMetadata> {
  const response = await fetch(canonicalUrl, { headers: { "user-agent": "WandreelExtractionBot/0.1", accept: "text/html,application/xhtml+xml" } });
  if (!response.ok) throw new Error(`Metadata fetch failed: ${response.status}`);
  const html = await response.text();
  const ogTitle = pickMeta(html, "og:title");
  const ogDescription = pickMeta(html, "og:description");
  const ogImage = pickMeta(html, "og:image");
  const ogSiteName = pickMeta(html, "og:site_name");
  const metaDescription = pickMeta(html, "description", "name");

  return {
    sourceUrl,
    canonicalUrl,
    platform: detectSourcePlatform(canonicalUrl),
    title: ogTitle || pickTitle(html) || "Untitled",
    description: ogDescription || metaDescription || "",
    siteName: ogSiteName || null,
    imageUrl: toAbsoluteUrl(canonicalUrl, ogImage),
    fetchedAtIso: new Date().toISOString(),
    provider: "html",
  };
}

export async function extractMetadata(sourceUrl: string): Promise<ExtractedMetadata> {
  const canonicalUrl = canonicalizeUrl(sourceUrl);
  assertSafeHost(canonicalUrl);
  const platform = detectSourcePlatform(canonicalUrl);

  if (platform === "youtube") {
    const parsed = await runPythonJsonScript("fetch_youtube_metadata.py", canonicalUrl, 30000);
    if (parsed?.ok) {
      return {
        sourceUrl,
        canonicalUrl,
        platform,
        title: String(parsed.title || "Untitled").trim() || "Untitled",
        description: String(parsed.description || "").trim(),
        siteName: "YouTube",
        imageUrl: String(parsed.thumbnail || "").trim() || null,
        fetchedAtIso: new Date().toISOString(),
        provider: "youtube_script",
      };
    }
  }

  if (platform === "instagram") {
    const parsed = await runPythonJsonScript("fetch_instagram_metadata.py", canonicalUrl, 30000);
    if (parsed?.ok) {
      return {
        sourceUrl,
        canonicalUrl,
        platform,
        title: String(parsed.title || "Untitled").trim() || "Untitled",
        description: String(parsed.description || "").trim(),
        siteName: "Instagram",
        imageUrl: String(parsed.thumbnail || "").trim() || null,
        fetchedAtIso: new Date().toISOString(),
        provider: "instagram_script",
      };
    }
  }

  return extractViaHtml(canonicalUrl, sourceUrl);
}

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

function isLowSignalInstagramMetadata(meta: ExtractedMetadata): boolean {
  if (meta.platform !== "instagram") return false;
  const title = String(meta.title || "").trim().toLowerCase();
  const description = String(meta.description || "").trim().toLowerCase();
  if (!title && !description) return true;
  if (title === "instagram") return true;
  if (description.includes("create an account or log in to instagram")) return true;
  return false;
}

const lastHighQualityInstagramMetadataByCanonicalUrl = new Map<string, ExtractedMetadata>();

function cloneMetadata(meta: ExtractedMetadata): ExtractedMetadata {
  return JSON.parse(JSON.stringify(meta)) as ExtractedMetadata;
}

function fromYoutubeScript(parsed: any, sourceUrl: string, canonicalUrl: string): ExtractedMetadata | null {
  if (!parsed?.ok) return null;
  return {
    sourceUrl,
    canonicalUrl,
    platform: "youtube",
    title: String(parsed.title || "Untitled").trim() || "Untitled",
    description: String(parsed.description || "").trim(),
    siteName: "YouTube",
    imageUrl: String(parsed.thumbnail || "").trim() || null,
    fetchedAtIso: new Date().toISOString(),
    provider: "youtube_script",
  };
}

function fromInstagramScript(parsed: any, sourceUrl: string, canonicalUrl: string): ExtractedMetadata | null {
  if (!parsed?.ok) return null;
  return {
    sourceUrl,
    canonicalUrl,
    platform: "instagram",
    title: String(parsed.title || "Untitled").trim() || "Untitled",
    description: String(parsed.description || "").trim(),
    siteName: "Instagram",
    imageUrl: String(parsed.thumbnail || "").trim() || null,
    fetchedAtIso: new Date().toISOString(),
    provider: "instagram_script",
  };
}

async function extractViaPlatformScript(platform: "youtube" | "instagram", canonicalUrl: string, sourceUrl: string): Promise<ExtractedMetadata> {
  if (platform === "youtube") {
    const parsed = await runPythonJsonScript("fetch_youtube_metadata.py", canonicalUrl, 30000);
    const out = fromYoutubeScript(parsed, sourceUrl, canonicalUrl);
    if (out) return out;
    throw new Error("youtube_script_failed");
  }

  const parsed = await runPythonJsonScript("fetch_instagram_metadata.py", canonicalUrl, 30000);
  const out = fromInstagramScript(parsed, sourceUrl, canonicalUrl);
  if (out) return out;
  throw new Error("instagram_script_failed");
}

export async function extractMetadata(sourceUrl: string): Promise<ExtractedMetadata> {
  const canonicalUrl = canonicalizeUrl(sourceUrl);
  assertSafeHost(canonicalUrl);
  const platform = detectSourcePlatform(canonicalUrl);

  if (platform === "instagram") {
    const rememberedHighQuality = lastHighQualityInstagramMetadataByCanonicalUrl.get(canonicalUrl);
    try {
      const scriptMeta = await extractViaPlatformScript("instagram", canonicalUrl, sourceUrl);
      if (!isLowSignalInstagramMetadata(scriptMeta)) {
        lastHighQualityInstagramMetadataByCanonicalUrl.set(canonicalUrl, cloneMetadata(scriptMeta));
        return scriptMeta;
      }

      // Retry script once for transient Instagram responses.
      const scriptMetaRetry = await extractViaPlatformScript("instagram", canonicalUrl, sourceUrl);
      if (!isLowSignalInstagramMetadata(scriptMetaRetry)) {
        lastHighQualityInstagramMetadataByCanonicalUrl.set(canonicalUrl, cloneMetadata(scriptMetaRetry));
        return scriptMetaRetry;
      }

      const htmlMeta = await extractViaHtml(canonicalUrl, sourceUrl);
      if (!isLowSignalInstagramMetadata(htmlMeta)) {
        lastHighQualityInstagramMetadataByCanonicalUrl.set(canonicalUrl, cloneMetadata(htmlMeta));
        return htmlMeta;
      }

      // Prevent generic Instagram metadata from replacing previously good extraction.
      if (rememberedHighQuality) {
        return {
          ...cloneMetadata(rememberedHighQuality),
          sourceUrl,
          fetchedAtIso: new Date().toISOString(),
        };
      }

      return scriptMetaRetry;
    } catch {
      // Fallback handled below.
    }
  }

  if (platform === "youtube") {
    try {
      return await Promise.any([
        extractViaPlatformScript("youtube", canonicalUrl, sourceUrl),
        extractViaHtml(canonicalUrl, sourceUrl),
      ]);
    } catch {
      // Fallback handled below.
    }
  }

  return extractViaHtml(canonicalUrl, sourceUrl);
}

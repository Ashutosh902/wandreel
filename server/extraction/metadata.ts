import type { ExtractedMetadata } from "./types";
import { runPythonJsonScript } from "./pythonRunner";
import { assertSafeHost, canonicalizeUrl, detectSourcePlatform } from "./url";

function isInstagramUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase().includes("instagram.com");
  } catch {
    return false;
  }
}

function formatErrorReason(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || "unknown_error");
}

function logMetadataDiagnostics(event: string, details: Record<string, unknown>) {
  console.info("[metadata-extraction]", {
    event,
    ...details,
  });
}

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
  const instagramUrlDetectionResult = isInstagramUrl(canonicalUrl);
  const failureReasons: string[] = [];

  logMetadataDiagnostics("start", {
    canonicalUrl,
    platformDetectionResult: platform,
    instagramUrlDetectionResult,
  });

  if (platform === "instagram") {
    const rememberedHighQuality = lastHighQualityInstagramMetadataByCanonicalUrl.get(canonicalUrl);
    let scriptMetaRetry: ExtractedMetadata | null = null;
    try {
      const scriptMeta = await extractViaPlatformScript("instagram", canonicalUrl, sourceUrl);
      if (!isLowSignalInstagramMetadata(scriptMeta)) {
        lastHighQualityInstagramMetadataByCanonicalUrl.set(canonicalUrl, cloneMetadata(scriptMeta));
        logMetadataDiagnostics("success", {
          canonicalUrl,
          platformDetectionResult: platform,
          instagramUrlDetectionResult,
          metadataProvider: scriptMeta.provider,
          metadataFailureReason: null,
        });
        return scriptMeta;
      }

      // Retry script once for transient Instagram responses.
      scriptMetaRetry = await extractViaPlatformScript("instagram", canonicalUrl, sourceUrl);
      if (!isLowSignalInstagramMetadata(scriptMetaRetry)) {
        lastHighQualityInstagramMetadataByCanonicalUrl.set(canonicalUrl, cloneMetadata(scriptMetaRetry));
        logMetadataDiagnostics("success", {
          canonicalUrl,
          platformDetectionResult: platform,
          instagramUrlDetectionResult,
          metadataProvider: scriptMetaRetry.provider,
          metadataFailureReason: null,
        });
        return scriptMetaRetry;
      }

      const htmlMeta = await extractViaHtml(canonicalUrl, sourceUrl);
      if (!isLowSignalInstagramMetadata(htmlMeta)) {
        lastHighQualityInstagramMetadataByCanonicalUrl.set(canonicalUrl, cloneMetadata(htmlMeta));
        logMetadataDiagnostics("success", {
          canonicalUrl,
          platformDetectionResult: platform,
          instagramUrlDetectionResult,
          metadataProvider: htmlMeta.provider,
          metadataFailureReason: null,
        });
        return htmlMeta;
      }

      // Prevent generic Instagram metadata from replacing previously good extraction.
      if (rememberedHighQuality) {
        logMetadataDiagnostics("success", {
          canonicalUrl,
          platformDetectionResult: platform,
          instagramUrlDetectionResult,
          metadataProvider: rememberedHighQuality.provider,
          metadataFailureReason: null,
          reusedRememberedMetadata: true,
        });
        return {
          ...cloneMetadata(rememberedHighQuality),
          sourceUrl,
          fetchedAtIso: new Date().toISOString(),
        };
      }

      logMetadataDiagnostics("success", {
        canonicalUrl,
        platformDetectionResult: platform,
        instagramUrlDetectionResult,
        metadataProvider: scriptMetaRetry.provider,
        metadataFailureReason: "instagram_low_signal_metadata",
      });
      return scriptMetaRetry;
    } catch (error) {
      const metadataFailureReason = formatErrorReason(error);
      failureReasons.push(`instagram_provider:${metadataFailureReason}`);
      logMetadataDiagnostics("provider_failed", {
        canonicalUrl,
        platformDetectionResult: platform,
        instagramUrlDetectionResult,
        metadataProvider: "instagram_script",
        metadataFailureReason,
      });
    }
  }

  if (platform === "youtube") {
    try {
      const metadata = await Promise.any([
        extractViaPlatformScript("youtube", canonicalUrl, sourceUrl),
        extractViaHtml(canonicalUrl, sourceUrl),
      ]);
      logMetadataDiagnostics("success", {
        canonicalUrl,
        platformDetectionResult: platform,
        instagramUrlDetectionResult,
        metadataProvider: metadata.provider,
        metadataFailureReason: null,
      });
      return metadata;
    } catch (error) {
      const metadataFailureReason = formatErrorReason(error);
      failureReasons.push(`youtube_provider:${metadataFailureReason}`);
      logMetadataDiagnostics("provider_failed", {
        canonicalUrl,
        platformDetectionResult: platform,
        instagramUrlDetectionResult,
        metadataProvider: "youtube_script_or_html",
        metadataFailureReason,
      });
    }
  }

  try {
    const metadata = await extractViaHtml(canonicalUrl, sourceUrl);
    logMetadataDiagnostics("success", {
      canonicalUrl,
      platformDetectionResult: platform,
      instagramUrlDetectionResult,
      metadataProvider: metadata.provider,
      metadataFailureReason: null,
    });
    return metadata;
  } catch (error) {
    const metadataFailureReason = formatErrorReason(error);
    failureReasons.push(`html_fallback:${metadataFailureReason}`);
    logMetadataDiagnostics("failed", {
      canonicalUrl,
      platformDetectionResult: platform,
      instagramUrlDetectionResult,
      metadataProvider: "html",
      metadataFailureReason,
    });
    throw new Error(
      [
        `metadata_extraction_failed`,
        `canonicalUrl=${canonicalUrl}`,
        `platformDetectionResult=${platform}`,
        `instagramUrlDetectionResult=${instagramUrlDetectionResult}`,
        ...failureReasons,
      ].join(" | "),
    );
  }
}

import type { ExtractedMetadata, MetadataCommentEvidence } from "./types";
import { runPythonJsonScript, runPythonJsonScriptWithArgs } from "./pythonRunner";
import { getPythonCommands } from "./pythonRuntime";
import { assertSafeHost, canonicalizeUrl, detectSourcePlatform } from "./url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

function shortPreview(value: unknown, maxLines = 5): string | null {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .join("\n");
}

function classifyFailureReason(input: unknown): string {
  const value = String(input || "").trim().toLowerCase();
  if (!value) return "unknown";
  if (value.includes("auth_config_missing")) return "auth_config_missing";
  if (value.includes("auth_fetch_failed")) return "auth_fetch_failed";
  if (value.includes("public_http_")) return "public_http_error";
  if (value.includes("public_fetch_failed")) return "public_fetch_failed";
  if (value.includes("missing_instaloader")) return "missing_instaloader";
  if (value.includes("instagram_metadata_unavailable")) return "instagram_metadata_unavailable";
  if (value.includes("timed out")) return "timeout";
  if (value.includes("eacces") || value.includes("fetch failed")) return "network_or_permissions";
  return "other";
}

type YtDlpMetadataProbe = {
  attempted: boolean;
  available: boolean;
  ok: boolean;
  title: string | null;
  descriptionPreview: string | null;
  uploader: string | null;
  webpageUrl: string | null;
  exitCode: number | string | null;
  stderrShortPreview: string | null;
  error: string | null;
};

async function probeYtDlpInstagramMetadata(canonicalUrl: string): Promise<YtDlpMetadataProbe> {
  const probeScript = [
    "import json",
    "import sys",
    "from yt_dlp import YoutubeDL",
    "url = sys.argv[1]",
    "with YoutubeDL({'quiet': True, 'skip_download': True, 'extract_flat': False}) as ydl:",
    "    info = ydl.extract_info(url, download=False)",
    "print(json.dumps({",
    "  'title': info.get('title'),",
    "  'description': info.get('description'),",
    "  'uploader': info.get('uploader'),",
    "  'webpage_url': info.get('webpage_url')",
    "}))",
  ].join("\n");
  const commands = getPythonCommands().map((command) => ({
    cmd: command.cmd,
    args: [...command.argsPrefix, "-c", probeScript, canonicalUrl],
  }));

  let lastError: unknown = null;
  for (const command of commands) {
    try {
      const { stdout } = await execFileAsync(command.cmd, command.args, {
        timeout: 25000,
        maxBuffer: 4 * 1024 * 1024,
        env: process.env,
      });
      const parsed = JSON.parse(String(stdout || "").trim() || "{}") as Record<string, unknown>;
      return {
        attempted: true,
        available: true,
        ok: true,
        title: String(parsed.title || "").trim() || null,
        descriptionPreview: shortPreview(parsed.description, 3),
        uploader: String(parsed.uploader || "").trim() || null,
        webpageUrl: String(parsed.webpage_url || "").trim() || null,
        exitCode: 0,
        stderrShortPreview: null,
        error: null,
      };
    } catch (error) {
      lastError = error;
    }
  }

  const err = lastError as { code?: number | string; stderr?: unknown; message?: unknown } | null;
  const message = String(err?.message || "yt_dlp_probe_failed");
  const missingModule = /No module named ['"]?yt_dlp/i.test(message) || /cannot find the file/i.test(message);
  return {
    attempted: true,
    available: !missingModule,
    ok: false,
    title: null,
    descriptionPreview: null,
    uploader: null,
    webpageUrl: null,
    exitCode: err?.code ?? null,
    stderrShortPreview: shortPreview(err?.stderr, 5),
    error: message,
  };
}

function emptyCommentEvidence(overrides?: Partial<MetadataCommentEvidence>): MetadataCommentEvidence {
  return {
    attempted: false,
    timedOut: false,
    pinnedComment: null,
    topComments: [],
    creatorReplies: [],
    commentsFetchedCount: 0,
    commentRepliesFetchedCount: 0,
    creatorReplyCount: 0,
    provider: null,
    reason: null,
    ...overrides,
  };
}

function sanitizeCommentText(input: unknown): string | null {
  const value = String(input || "").replace(/\s+/g, " ").trim();
  return value || null;
}

function sanitizeCommentList(input: unknown, maxItems: number): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    const text = sanitizeCommentText(item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
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
    commentEvidence: emptyCommentEvidence({ provider: "public_meta" }),
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
    commentEvidence: emptyCommentEvidence({ provider: "fallback" }),
  };
}

function fromInstagramScript(parsed: any, sourceUrl: string, canonicalUrl: string): ExtractedMetadata | null {
  if (!parsed?.ok) return null;
  const pinnedComment = sanitizeCommentText(parsed?.pinnedComment);
  const creatorReplies = sanitizeCommentList(parsed?.creatorReplies, 3);
  const topComments = sanitizeCommentList([...(parsed?.creatorReplies ?? []), ...(parsed?.topComments ?? parsed?.comments ?? [])], 5).filter(
    (item) => item.toLowerCase() !== String(pinnedComment || "").toLowerCase(),
  );
  const commentFetchAttempted = Boolean(parsed?.commentFetchAttempted);
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
    commentEvidence: emptyCommentEvidence({
      attempted: commentFetchAttempted,
      pinnedComment,
      topComments,
      creatorReplies,
      commentsFetchedCount: Number(parsed?.commentsFetchedCount) || topComments.length,
      commentRepliesFetchedCount: Number(parsed?.commentRepliesFetchedCount) || creatorReplies.length,
      creatorReplyCount: Number(parsed?.creatorReplyCount) || creatorReplies.length,
      provider: "instagram_script",
      reason: commentFetchAttempted && !pinnedComment && topComments.length === 0 ? "comments_not_available" : null,
    }),
  };
}

export async function extractInstagramCommentEvidence(sourceUrl: string): Promise<MetadataCommentEvidence> {
  const canonicalUrl = canonicalizeUrl(sourceUrl);
  const parsed = await runPythonJsonScriptWithArgs("fetch_instagram_metadata.py", [canonicalUrl, "3", "comments_only"], 8000);
  if (!parsed || typeof parsed !== "object") {
    return emptyCommentEvidence({
      attempted: true,
      provider: "instagram_script",
      reason: "comments_unavailable",
    });
  }
  if (!parsed.ok) {
    return emptyCommentEvidence({
      attempted: true,
      provider: "instagram_script",
      reason: formatErrorReason(parsed.error || "comments_unavailable"),
    });
  }

  const pinnedComment = sanitizeCommentText(parsed.pinnedComment);
  const creatorReplies = sanitizeCommentList(parsed.creatorReplies, 3);
  const topComments = sanitizeCommentList([...(parsed.creatorReplies ?? []), ...(parsed.topComments ?? parsed.comments ?? [])], 5).filter(
    (item) => item.toLowerCase() !== String(pinnedComment || "").toLowerCase(),
  );
  return emptyCommentEvidence({
    attempted: true,
    pinnedComment,
    topComments,
    creatorReplies,
    commentsFetchedCount: Number(parsed.commentsFetchedCount) || topComments.length,
    commentRepliesFetchedCount: Number(parsed.commentRepliesFetchedCount) || creatorReplies.length,
    creatorReplyCount: Number(parsed.creatorReplyCount) || creatorReplies.length,
    provider: "instagram_script",
    reason: pinnedComment || topComments.length > 0 ? null : "comments_not_available",
  });
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
  const diagnostic = {
    error: formatErrorReason(parsed?.error || "instagram_script_failed"),
    errorClass: classifyFailureReason(parsed?.error),
    authError: formatErrorReason(parsed?.authError || ""),
    authErrorClass: classifyFailureReason(parsed?.authError),
    publicError: formatErrorReason(parsed?.publicError || ""),
    publicErrorClass: classifyFailureReason(parsed?.publicError),
    exitCode: parsed?.exitCode ?? null,
    stderrShortPreview: shortPreview(parsed?.stderrShortPreview || parsed?.stderr, 5),
    titlePreview: shortPreview(parsed?.title, 1),
    descriptionPreview: shortPreview(parsed?.description, 2),
    source: parsed?.source || null,
    authenticated: parsed?.authenticated ?? null,
    authMode: String(process.env.INSTAGRAM_AUTH_MODE || "auto"),
    hasInstagramUsername: Boolean(String(process.env.INSTAGRAM_USERNAME || "").trim()),
    hasInstagramPassword: Boolean(String(process.env.INSTAGRAM_PASSWORD || "").trim()),
    hasInstagramSessionId: Boolean(String(process.env.INSTAGRAM_SESSIONID || process.env.IG_SESSIONID || "").trim()),
  };
  throw new Error(`instagram_script_failed | ${JSON.stringify(diagnostic)}`);
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
      const ytDlpProbe = await probeYtDlpInstagramMetadata(canonicalUrl).catch((probeError) => ({
        attempted: true,
        available: false,
        ok: false,
        title: null,
        descriptionPreview: null,
        uploader: null,
        webpageUrl: null,
        exitCode: null,
        stderrShortPreview: null,
        error: formatErrorReason(probeError),
      }));
      logMetadataDiagnostics("provider_failed", {
        canonicalUrl,
        platformDetectionResult: platform,
        instagramUrlDetectionResult,
        metadataProvider: "instagram_script",
        metadataFailureReason,
        instagramScriptFailureClass: classifyFailureReason(metadataFailureReason),
        ytDlpProbe,
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

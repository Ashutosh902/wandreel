import type { ExtractedMetadata, OcrResult, ScreenshotAsset } from "./types";
import { runPythonJsonScript, runPythonJsonScriptWithArgs } from "./pythonRunner";
import { extractVisionOcr, extractVisionOcrFromScreenshots } from "./visionOcr";
import { selectSourceScreenshots } from "./frameSelection";
import fs from "node:fs/promises";
import { createSign } from "node:crypto";

type ImagePathOcrProvider = "google_vision" | "local_python";
type ImagePathOcrResult = {
  text: string;
  reason: string | null;
  provider: ImagePathOcrProvider | "google_vision_failed";
};

type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

let googleServiceAccountPromise: Promise<GoogleServiceAccount | null> | null = null;
let googleAccessTokenCache:
  | {
      token: string;
      expiresAtMs: number;
    }
  | null = null;

export async function enrichWithFrameOcr(metadata: ExtractedMetadata, screenshotsInput?: ScreenshotAsset[]): Promise<OcrResult> {
  const screenshots = screenshotsInput ?? (await selectSourceScreenshots(metadata));
  if (screenshots.length > 0) {
    const visionScreens = await extractVisionOcrFromScreenshots(screenshots);
    if (visionScreens.text.trim()) {
      const screenshot = screenshots.length === 1 ? screenshots[0] : null;
      return {
        attempted: true,
        used: true,
        text: visionScreens.text.trim(),
        reason: null,
        provider: "openai_vision",
        regions: screenshot
          ? [{
              text: visionScreens.text.trim(),
              frameLabel: screenshot.label,
              frameIndex: screenshot.frameIndex,
              timestampSec: screenshot.timestampSec,
              boundingBox: null,
            }]
          : undefined,
      };
    }
  }

  if (metadata.platform === "youtube" || metadata.platform === "instagram") {
    const parsed = await runPythonJsonScript("fetch_ocr_text.py", metadata.canonicalUrl, 120000);
    if (parsed?.ok && typeof parsed.text === "string" && parsed.text.trim()) {
      return { attempted: true, used: true, text: parsed.text.trim(), reason: null, provider: String(parsed.engine || "local_python") };
    }

    const pythonReason = typeof parsed?.errorCode === "string"
      ? parsed.errorCode
      : typeof parsed?.status === "string"
        ? parsed.status
        : typeof parsed?.error === "string"
          ? parsed.error
          : "ocr_not_available";

    if (metadata.imageUrl) {
      const vision = await extractVisionOcr(metadata.imageUrl);
      if (vision.text.trim()) {
        return { attempted: true, used: true, text: vision.text.trim(), reason: null, provider: "openai_vision" };
      }
      if (vision.reason) {
        return {
          attempted: true,
          used: false,
          text: "",
          reason: `${pythonReason};${vision.reason}`,
        };
      }
    }

    return {
      attempted: true,
      used: false,
      text: "",
      reason: pythonReason,
    };
  }

  if (metadata.imageUrl) {
    const vision = await extractVisionOcr(metadata.imageUrl);
    if (vision.text.trim()) {
      return { attempted: true, used: true, text: vision.text.trim(), reason: null, provider: "openai_vision" };
    }
    if (vision.reason) {
      return {
        attempted: true,
        used: false,
        text: "",
        reason: vision.reason,
      };
    }
  }

  return {
    attempted: screenshots.length > 0 || Boolean(metadata.imageUrl),
    used: false,
    text: "",
    reason: screenshots.length > 0 ? "vision_ocr_empty" : "ocr_not_available",
  };
}

export async function extractLocalOcrFromImagePath(imagePath: string): Promise<{ text: string; reason: string | null }> {
  if (!String(imagePath || "").trim()) {
    return { text: "", reason: "ocr_image_path_missing" };
  }
  const parsed = await runPythonJsonScriptWithArgs("fetch_ocr_text.py", ["--image-path", imagePath], 120000);
  if (parsed?.ok && typeof parsed.text === "string" && parsed.text.trim()) {
    return { text: parsed.text.trim(), reason: null };
  }

  const reason = typeof parsed?.errorCode === "string"
    ? parsed.errorCode
    : typeof parsed?.status === "string"
      ? parsed.status
      : typeof parsed?.error === "string"
        ? parsed.error
        : "ocr_not_available";

  return {
    text: "",
    reason,
  };
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function getGoogleVisionApiKey(): string | null {
  return String(process.env.GOOGLE_VISION_API_KEY || "").trim() || null;
}

function getGoogleApplicationCredentialsPath(): string | null {
  return String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim() || null;
}

function shouldAvoidLocalPythonFallback(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(process.env.RENDER);
}

async function loadGoogleServiceAccount(): Promise<GoogleServiceAccount | null> {
  if (googleServiceAccountPromise) return googleServiceAccountPromise;
  googleServiceAccountPromise = (async () => {
    const credentialsPath = getGoogleApplicationCredentialsPath();
    if (!credentialsPath) return null;
    try {
      const raw = await fs.readFile(credentialsPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<GoogleServiceAccount>;
      if (!parsed.client_email || !parsed.private_key) return null;
      return {
        client_email: parsed.client_email,
        private_key: parsed.private_key,
        token_uri: parsed.token_uri || "https://oauth2.googleapis.com/token",
      };
    } catch {
      return null;
    }
  })();
  return googleServiceAccountPromise;
}

async function getGoogleVisionAccessToken(): Promise<string | null> {
  if (googleAccessTokenCache && googleAccessTokenCache.expiresAtMs > Date.now() + 60_000) {
    return googleAccessTokenCache.token;
  }

  const serviceAccount = await loadGoogleServiceAccount();
  if (!serviceAccount) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: serviceAccount.token_uri || "https://oauth2.googleapis.com/token",
      exp: nowSeconds + 3600,
      iat: nowSeconds,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key);
  const assertion = `${unsigned}.${base64UrlEncode(signature)}`;

  const response = await fetch(serviceAccount.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  const token = String(payload.access_token || "").trim();
  if (!token) return null;
  googleAccessTokenCache = {
    token,
    expiresAtMs: Date.now() + (Number(payload.expires_in || 3600) * 1000),
  };
  return token;
}

async function extractGoogleVisionOcrFromImagePath(imagePath: string): Promise<{ text: string; reason: string | null }> {
  const raw = await fs.readFile(imagePath);
  const content = raw.toString("base64");
  const apiKey = getGoogleVisionApiKey();
  const token = apiKey ? null : await getGoogleVisionAccessToken();
  if (!apiKey && !token) {
    return { text: "", reason: "google_vision_not_configured" };
  }

  const endpoint = apiKey
    ? `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`
    : "https://vision.googleapis.com/v1/images:annotate";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      requests: [
        {
          image: { content },
          features: [{ type: "TEXT_DETECTION" }],
        },
      ],
    }),
  });
  if (!response.ok) {
    return { text: "", reason: `google_vision_http_${response.status}` };
  }
  const payload = (await response.json()) as {
    responses?: Array<{
      fullTextAnnotation?: { text?: string };
      textAnnotations?: Array<{ description?: string }>;
      error?: { message?: string };
    }>;
  };
  const first = Array.isArray(payload.responses) ? payload.responses[0] : null;
  const text = String(first?.fullTextAnnotation?.text || first?.textAnnotations?.[0]?.description || "").trim();
  if (text) {
    return { text, reason: null };
  }
  return {
    text: "",
    reason: String(first?.error?.message || "google_vision_empty").trim() || "google_vision_empty",
  };
}

export async function extractImagePathOcr(imagePath: string): Promise<ImagePathOcrResult> {
  if (!String(imagePath || "").trim()) {
    return { text: "", reason: "ocr_image_path_missing", provider: "local_python" };
  }

  const googleConfigured = Boolean(getGoogleVisionApiKey() || getGoogleApplicationCredentialsPath());
  if (googleConfigured) {
    try {
      const google = await extractGoogleVisionOcrFromImagePath(imagePath);
      if (google.text.trim()) {
        return {
          text: google.text.trim(),
          reason: null,
          provider: "google_vision",
        };
      }
      if (google.reason && google.reason !== "google_vision_not_configured") {
        if (shouldAvoidLocalPythonFallback()) {
          return {
            text: "",
            reason: google.reason,
            provider: "google_vision_failed",
          };
        }
        const fallback = await extractLocalOcrFromImagePath(imagePath);
        return {
          text: fallback.text,
          reason: fallback.text.trim() ? null : `${google.reason};${fallback.reason || "local_python_empty"}`,
          provider: fallback.text.trim() ? "local_python" : "local_python",
        };
      }
    } catch {
      if (shouldAvoidLocalPythonFallback()) {
        return {
          text: "",
          reason: "google_vision_failed",
          provider: "google_vision_failed",
        };
      }
      const fallback = await extractLocalOcrFromImagePath(imagePath);
      return {
        text: fallback.text,
        reason: fallback.reason || "local_python_failed",
        provider: "local_python",
      };
    }
  }

  const fallback = await extractLocalOcrFromImagePath(imagePath);
  return {
    text: fallback.text,
    reason: fallback.reason,
    provider: "local_python",
  };
}

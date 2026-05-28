import type { SourcePlatform } from "./types";

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "169.254.169.254"]);

export function canonicalizeUrl(urlString: string): string {
  const parsed = new URL(urlString);
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") throw new Error("Only http/https URLs are allowed");

  parsed.hash = "";
  parsed.username = "";
  parsed.password = "";
  parsed.host = parsed.host.toLowerCase();
  if ((parsed.protocol === "http:" && parsed.port === "80") || (parsed.protocol === "https:" && parsed.port === "443")) parsed.port = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.toString();
}

export function detectSourcePlatform(urlString: string): SourcePlatform {
  const host = new URL(urlString).hostname.toLowerCase();
  if (host.includes("youtube.com") || host === "youtu.be") return "youtube";
  if (host.includes("instagram.com")) return "instagram";
  return "web";
}

export function assertSafeHost(urlString: string): void {
  const host = new URL(urlString).hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) throw new Error("Blocked host");
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) || host === "::1") {
    throw new Error("Blocked private host");
  }
}

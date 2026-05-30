import type { ExtractedMetadata, OcrResult, TranscriptResult } from "./types";

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function normalizeWhitespace(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeLineForDedup(line: string): string {
  return line.toLowerCase().replace(/[^\p{L}\p{N}#:\s]/gu, "").replace(/\s+/g, " ").trim();
}

function dedupeLines(lines: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  let deduped = 0;
  for (const line of lines) {
    const key = normalizeLineForDedup(line);
    if (!key) continue;
    if (seen.has(key)) {
      deduped += 1;
      continue;
    }
    seen.add(key);
    out.push(line);
  }
  return { lines: out, deduped };
}

function dedupeHashtags(input: string) {
  const tags = input.match(/#[\p{L}\p{N}_]+/gu) || [];
  const seen = new Set<string>();
  let deduped = 0;
  for (const t of tags) {
    const k = t.toLowerCase();
    if (seen.has(k)) deduped += 1;
    seen.add(k);
  }

  // Remove all hashtags first, then append unique list at end to avoid noisy repetition.
  const textWithoutTags = input.replace(/(?:^|\s)#[\p{L}\p{N}_]+/gu, " ").replace(/\s+/g, " ").trim();
  const uniqueTags = Array.from(seen);
  const merged = uniqueTags.length ? `${textWithoutTags}\n\n${uniqueTags.join(" ")}` : textWithoutTags;
  return { text: merged, deduped };
}

function stripBoilerplate(lines: string[]) {
  const patterns = [
    /create an account or log in to instagram/i,
    /share what you're into with the people who get you/i,
  ];
  const out: string[] = [];
  let dropped = 0;
  for (const line of lines) {
    if (patterns.some((p) => p.test(line))) {
      dropped += 1;
      continue;
    }
    out.push(line);
  }
  return { lines: out, dropped };
}

export function buildCombinedText(input: {
  metadata: ExtractedMetadata;
  transcript: TranscriptResult | null;
  ocr: OcrResult | null;
}) {
  const title = String(input.metadata.title || "").trim();
  const description = String(input.metadata.description || "").trim();
  const transcript = String(input.transcript?.text || "").trim();
  const ocr = String(input.ocr?.text || "").trim();

  const raw = [title, description, transcript, ocr].filter(Boolean).join("\n\n").trim();
  const rawDecoded = decodeHtmlEntities(raw);
  const normalized = normalizeWhitespace(rawDecoded);
  const split = normalized.split("\n").map((s) => s.trim()).filter(Boolean);
  const stripped = stripBoilerplate(split);
  const deduped = dedupeLines(stripped.lines);
  const merged = deduped.lines.join("\n");
  const hashtagClean = dedupeHashtags(merged);
  const clean = normalizeWhitespace(hashtagClean.text).slice(0, 6000);

  return {
    combinedTextRaw: normalized,
    combinedTextClean: clean,
    cleanupStats: {
      rawChars: normalized.length,
      cleanChars: clean.length,
      removedChars: Math.max(0, normalized.length - clean.length),
      droppedLines: stripped.dropped,
      dedupedLines: deduped.deduped,
      dedupedHashtags: hashtagClean.deduped,
    },
  };
}


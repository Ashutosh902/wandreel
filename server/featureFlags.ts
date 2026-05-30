function isEnabled(name: string, defaultValue = false): boolean {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export const featureFlags = {
  extractionV2: isEnabled("EXTRACTION_V2_ENABLED", true),
  intelligenceStructured: isEnabled("INTELLIGENCE_STRUCTURED_ENABLED", true),
  categoryLevel2: isEnabled("CATEGORY_LEVEL2_ENABLED", true),
};


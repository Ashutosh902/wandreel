export const SPLASH_DURATION_MS = 2000;
export const SPLASH_TRIGGER = "every_open" as const;

export const BRAND_TOKENS = {
  colors: {
    bgTop: "#f7f7f8",
    bgBottom: "#f1ece6",
    orangeStart: "#ff7a00",
    orangeEnd: "#ff4d1f",
    charcoal: "#1c212b",
    muted: "#7a7f88",
    accentSoft: "#d9c8b8",
  },
  spacing: {
    xs: "0.25rem",
    sm: "0.5rem",
    md: "1rem",
    lg: "1.5rem",
    xl: "2rem",
  },
  typography: {
    brand: "\"Sora\", \"Segoe UI\", sans-serif",
    trackingWide: "0.18em",
  },
} as const;

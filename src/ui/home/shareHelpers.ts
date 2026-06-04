import type { SavedPlaceRecord } from "./savedPlaces";

const APP_SHARE_URL = "https://app.wandreel.com";

type SharePayload = {
  title: string;
  text: string;
  url?: string;
};

async function copyTextFallback(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "true");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  document.body.removeChild(input);
}

async function sharePayloadExternally(payload: SharePayload) {
  if (navigator.share) {
    await navigator.share(payload);
    return "shared" as const;
  }

  await copyTextFallback([payload.text, payload.url].filter(Boolean).join("\n"));
  return "copied" as const;
}

export function buildPlaceMapsUrl(place: Pick<SavedPlaceRecord, "title" | "locality" | "fullAddress" | "lat" | "lng">) {
  if (typeof place.lat === "number" && typeof place.lng === "number") {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.lat},${place.lng}`)}`;
  }

  const query = place.fullAddress?.trim() || `${place.title} ${place.locality}`.trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function buildPlaceShareMessage(place: SavedPlaceRecord) {
  const mapsUrl = buildPlaceMapsUrl(place);
  const locationLine = place.fullAddress?.trim() || place.locality?.trim() || "Saved on Wandreel";
  return `Found on Wandreel: ${place.title}\n${locationLine}\n${mapsUrl}\n${APP_SHARE_URL}`;
}

export async function sharePlaceExternally(place: SavedPlaceRecord) {
  return sharePayloadExternally({
    title: `${place.title} on Wandreel`,
    text: buildPlaceShareMessage(place),
    url: APP_SHARE_URL,
  });
}

export async function shareAppExternally() {
  return sharePayloadExternally({
    title: "Wandreel",
    text: "Join me on Wandreel to save places, reels, and city memories.",
    url: APP_SHARE_URL,
  });
}

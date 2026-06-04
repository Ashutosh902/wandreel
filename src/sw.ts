/// <reference lib="webworker" />

import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import {
  SHARED_INTENT_CLIENT_MESSAGE,
  buildShareTargetAppUrl,
  buildSharedIntentPayload,
  writePendingSharedIntent,
} from "./pwa/shareTarget";

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{
    url: string;
    revision: string | null;
  }>;
};

const IS_DEV = import.meta.env.DEV;

self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

async function notifyClients() {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type: SHARED_INTENT_CLIENT_MESSAGE });
  }
}

async function handleShareTarget(request: Request) {
  const formData = await request.formData();
  const payload = buildSharedIntentPayload({
    title: formData.get("title")?.toString(),
    text: formData.get("text")?.toString(),
    url: formData.get("url")?.toString(),
  });

  if (IS_DEV) {
    console.debug("[share-target] received", {
      title: formData.get("title")?.toString() || "",
      text: formData.get("text")?.toString() || "",
      url: formData.get("url")?.toString() || "",
    });
    console.debug("[share-target] extracted URL", payload?.extractedUrl || null);
  }

  if (payload) {
    await writePendingSharedIntent(payload);
  }

  await notifyClients();

  return Response.redirect(buildShareTargetAppUrl(), 303);
}

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.pathname === "/share-target" && event.request.method === "POST") {
    event.respondWith(handleShareTarget(event.request));
  }
});

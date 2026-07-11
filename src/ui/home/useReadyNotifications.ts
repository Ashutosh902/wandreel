import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ADD_READY_UPDATED_EVENT,
  readReadyNotifications,
  type AddReadyNotification,
} from "./addFlowState";

const DISMISSED_READY_NOTIFICATION_IDS_KEY = "wr_dismissed_ready_notification_ids_v1";

function readDismissedNotificationIds() {
  try {
    const raw = window.localStorage.getItem(DISMISSED_READY_NOTIFICATION_IDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function useReadyNotifications() {
  const [readyNotifications, setReadyNotifications] = useState<AddReadyNotification[]>(() => readReadyNotifications());
  const [dismissedNotificationIds, setDismissedNotificationIds] = useState<string[]>(readDismissedNotificationIds);

  const visibleReadyNotifications = useMemo(
    () => readyNotifications.filter((item) => !dismissedNotificationIds.includes(item.id)),
    [dismissedNotificationIds, readyNotifications],
  );

  const refreshReadyNotifications = useCallback(() => {
    setReadyNotifications(readReadyNotifications());
  }, []);

  const persistDismissedNotificationIds = useCallback((nextIds: string[]) => {
    setDismissedNotificationIds(nextIds);
    window.localStorage.setItem(DISMISSED_READY_NOTIFICATION_IDS_KEY, JSON.stringify(nextIds));
  }, []);

  const dismissNotification = useCallback((id: string) => {
    persistDismissedNotificationIds(
      dismissedNotificationIds.includes(id) ? dismissedNotificationIds : [...dismissedNotificationIds, id],
    );
  }, [dismissedNotificationIds, persistDismissedNotificationIds]);

  useEffect(() => {
    refreshReadyNotifications();
    const onReadyUpdate = () => refreshReadyNotifications();
    window.addEventListener(ADD_READY_UPDATED_EVENT, onReadyUpdate);
    window.addEventListener("storage", onReadyUpdate);
    return () => {
      window.removeEventListener(ADD_READY_UPDATED_EVENT, onReadyUpdate);
      window.removeEventListener("storage", onReadyUpdate);
    };
  }, [refreshReadyNotifications]);

  useEffect(() => {
    const validIds = new Set(readyNotifications.map((item) => item.id));
    const nextDismissedIds = dismissedNotificationIds.filter((id) => validIds.has(id));
    if (nextDismissedIds.length !== dismissedNotificationIds.length) {
      persistDismissedNotificationIds(nextDismissedIds);
    }
  }, [dismissedNotificationIds, persistDismissedNotificationIds, readyNotifications]);

  return {
    readyNotifications,
    visibleReadyNotifications,
    refreshReadyNotifications,
    dismissNotification,
  };
}

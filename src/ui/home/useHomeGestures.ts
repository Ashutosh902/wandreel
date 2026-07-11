import { useMemo, useRef, useState } from "react";
import type { TouchEvent } from "react";

export function useHomeGestures(options: {
  isMapTab: boolean;
  onBackGesture: () => void;
  showToast: (toast: { message: string; variant: "success" | "error" | "info"; durationMs?: number }) => void;
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; edge: "left" | "right" } | null>(null);
  const pullStartYRef = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);

  const touchHandlers = useMemo(() => ({
    onTouchStart: (event: TouchEvent<HTMLDivElement>) => {
      const touch = event.touches[0];
      const viewportWidth = window.innerWidth || 390;
      const isLeftEdge = touch.clientX <= 28;
      const isRightEdge = touch.clientX >= viewportWidth - 28;
      if (isLeftEdge) {
        touchStartRef.current = { x: touch.clientX, y: touch.clientY, edge: "left" };
        return;
      }
      if (isRightEdge) {
        touchStartRef.current = { x: touch.clientX, y: touch.clientY, edge: "right" };
      } else {
        touchStartRef.current = null;
      }
      const canPullRefresh =
        !options.isMapTab &&
        surfaceRef.current &&
        surfaceRef.current.scrollTop <= 0 &&
        touch.clientY <= 112;
      pullStartYRef.current = canPullRefresh ? touch.clientY : null;
      pullDistanceRef.current = 0;
    },
    onTouchMove: (event: TouchEvent<HTMLDivElement>) => {
      if (pullStartYRef.current === null) return;
      const deltaY = event.touches[0].clientY - pullStartYRef.current;
      pullDistanceRef.current = Math.max(0, deltaY);
    },
    onTouchEnd: (event: TouchEvent<HTMLDivElement>) => {
      if (touchStartRef.current) {
        const touch = event.changedTouches[0];
        const deltaX = touch.clientX - touchStartRef.current.x;
        const deltaY = Math.abs(touch.clientY - touchStartRef.current.y);
        const edge = touchStartRef.current.edge;
        touchStartRef.current = null;
        const isLeftEdgeBack = edge === "left" && deltaX > 56;
        const isRightEdgeBack = edge === "right" && deltaX < -56;
        if ((isLeftEdgeBack || isRightEdgeBack) && deltaY < 48) {
          options.onBackGesture();
        }
      }
      if (pullStartYRef.current !== null && pullDistanceRef.current > 72 && !isRefreshing) {
        setIsRefreshing(true);
        window.setTimeout(() => {
          setIsRefreshing(false);
          options.showToast({ message: "Refreshed", variant: "success", durationMs: 1800 });
        }, 650);
      }
      pullStartYRef.current = null;
      pullDistanceRef.current = 0;
    },
  }), [isRefreshing, options]);

  return {
    isRefreshing,
    surfaceRef,
    touchHandlers,
  };
}

import { useCallback, useEffect, useState } from "react";
import {
  buildPlannerUrlUpdate,
  getPlannerRouteFromPathname,
  type PlannerRoute,
} from "./homeNavigation";
import { isFoodTrailDemoEnabled } from "./foodTrailPlannerDemo";
import { isWeekendPlannerDemoEnabled } from "./weekendPlannerDemo";

function getFoodTrailDemoPreviewState(url: URL, isDev: boolean): boolean {
  return getPlannerRouteFromPathname(url.pathname) === "food-trail" && isFoodTrailDemoEnabled(url.search, isDev);
}

function getWeekendPlannerDemoPreviewState(url: URL, isDev: boolean): boolean {
  return getPlannerRouteFromPathname(url.pathname) === "weekend-plan" && isWeekendPlannerDemoEnabled(url.search, isDev);
}

export function useHomeNavigation(options: {
  isDev: boolean;
  foodTrailDemoQueryParam: string;
}) {
  const [plannerRoute, setPlannerRoute] = useState<PlannerRoute>(() => (
    typeof window !== "undefined" ? getPlannerRouteFromPathname(window.location.pathname) : "home"
  ));
  const [isFoodTrailDemoPreview, setIsFoodTrailDemoPreview] = useState<boolean>(() => (
    typeof window !== "undefined" ? getFoodTrailDemoPreviewState(new URL(window.location.href), options.isDev) : false
  ));
  const [isWeekendPlannerDemoPreview, setIsWeekendPlannerDemoPreview] = useState<boolean>(() => (
    typeof window !== "undefined" ? getWeekendPlannerDemoPreviewState(new URL(window.location.href), options.isDev) : false
  ));

  const setPlannerPath = useCallback((nextRoute: PlannerRoute, replace = false) => {
    if (typeof window === "undefined") return;
    const { url: nextUrl, historyPath } = buildPlannerUrlUpdate(
      window.location.href,
      nextRoute,
      options.foodTrailDemoQueryParam,
    );
    if (replace) {
      window.history.replaceState({}, "", historyPath);
    } else {
      window.history.pushState({}, "", historyPath);
    }
    setPlannerRoute(nextRoute);
    setIsFoodTrailDemoPreview(getFoodTrailDemoPreviewState(nextUrl, options.isDev));
    setIsWeekendPlannerDemoPreview(getWeekendPlannerDemoPreviewState(nextUrl, options.isDev));
  }, [options.foodTrailDemoQueryParam, options.isDev]);

  useEffect(() => {
    const handlePopState = () => {
      const url = new URL(window.location.href);
      setPlannerRoute(getPlannerRouteFromPathname(url.pathname));
      setIsFoodTrailDemoPreview(getFoodTrailDemoPreviewState(url, options.isDev));
      setIsWeekendPlannerDemoPreview(getWeekendPlannerDemoPreviewState(url, options.isDev));
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [options.isDev]);

  return {
    plannerRoute,
    setPlannerPath,
    isFoodTrailDemoPreview,
    isWeekendPlannerDemoPreview,
  };
}

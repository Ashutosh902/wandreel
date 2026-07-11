export type PlannerRoute = "home" | "food-trail" | "weekend-plan" | "stroll-create" | `stroll-detail:${string}`;

export function getPlannerRouteFromPathname(pathname: string): PlannerRoute {
  if (pathname.startsWith("/trail/food")) return "food-trail";
  if (pathname.startsWith("/plan/weekend")) return "weekend-plan";
  if (pathname.startsWith("/stroll/create")) return "stroll-create";
  const strollDetailMatch = pathname.match(/^\/stroll\/([^/]+)$/);
  if (strollDetailMatch?.[1]) return `stroll-detail:${decodeURIComponent(strollDetailMatch[1])}`;
  return "home";
}

export function getPlannerPathname(route: PlannerRoute): string {
  if (route === "food-trail") return "/trail/food";
  if (route === "weekend-plan") return "/plan/weekend";
  if (route === "stroll-create") return "/stroll/create";
  if (route.startsWith("stroll-detail:")) return `/stroll/${encodeURIComponent(getStrollIdFromPlannerRoute(route) || "")}`;
  return "/";
}

export function getStrollIdFromPlannerRoute(route: PlannerRoute): string | null {
  return route.startsWith("stroll-detail:") ? route.slice("stroll-detail:".length) || null : null;
}

export function getStrollDetailRoute(strollId: string): PlannerRoute {
  return `stroll-detail:${strollId}`;
}

export function buildPlannerUrlUpdate(
  currentHref: string,
  nextRoute: PlannerRoute,
  foodTrailDemoQueryParam: string,
) {
  const nextUrl = new URL(currentHref);
  nextUrl.pathname = getPlannerPathname(nextRoute);
  if (nextRoute !== "food-trail") {
    nextUrl.searchParams.delete(foodTrailDemoQueryParam);
  }
  return {
    url: nextUrl,
    historyPath: `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
  };
}

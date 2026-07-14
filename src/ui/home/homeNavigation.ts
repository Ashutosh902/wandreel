export type PlannerRoute = "home" | "food-trail" | "weekend-plan" | "stroll-create" | `stroll-edit:${string}` | `stroll-detail:${string}`;

export function getPlannerRouteFromPathname(pathname: string): PlannerRoute {
  if (pathname.startsWith("/trail/food")) return "food-trail";
  if (pathname.startsWith("/plan/weekend")) return "weekend-plan";
  if (pathname.startsWith("/stroll/create")) return "stroll-create";
  const strollEditMatch = pathname.match(/^\/stroll\/([^/]+)\/edit$/);
  if (strollEditMatch?.[1]) return `stroll-edit:${decodeURIComponent(strollEditMatch[1])}`;
  const strollDetailMatch = pathname.match(/^\/stroll\/([^/]+)$/);
  if (strollDetailMatch?.[1]) return `stroll-detail:${decodeURIComponent(strollDetailMatch[1])}`;
  return "home";
}

export function getPlannerPathname(route: PlannerRoute): string {
  if (route === "food-trail") return "/trail/food";
  if (route === "weekend-plan") return "/plan/weekend";
  if (route === "stroll-create") return "/stroll/create";
  if (route.startsWith("stroll-edit:")) return `/stroll/${encodeURIComponent(getStrollIdFromPlannerRoute(route) || "")}/edit`;
  if (route.startsWith("stroll-detail:")) return `/stroll/${encodeURIComponent(getStrollIdFromPlannerRoute(route) || "")}`;
  return "/";
}

export function getStrollIdFromPlannerRoute(route: PlannerRoute): string | null {
  if (route.startsWith("stroll-detail:")) return route.slice("stroll-detail:".length) || null;
  if (route.startsWith("stroll-edit:")) return route.slice("stroll-edit:".length) || null;
  return null;
}

export function getStrollDetailRoute(strollId: string): PlannerRoute {
  return `stroll-detail:${strollId}`;
}

export function getStrollEditRoute(strollId: string): PlannerRoute {
  return `stroll-edit:${strollId}`;
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

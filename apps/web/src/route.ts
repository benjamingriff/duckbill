import { useEffect, useState } from "react";

// A small path router: the API server and Vite both serve index.html for
// unknown paths, so /transactions etc. load directly.
export const PAGES = [
  { path: "/", label: "Overview" },
  { path: "/plan", label: "Plan" },
  { path: "/insights", label: "Insights" },
  { path: "/transactions", label: "Transactions" },
] as const;

export type PagePath = (typeof PAGES)[number]["path"];

function current(): PagePath {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return PAGES.find((p) => p.path === path)?.path ?? "/";
}

export function navigate(path: PagePath): void {
  if (path === current()) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

/** The page the URL points at, updating on back/forward and navigate(). */
export function usePage(): PagePath {
  const [page, setPage] = useState(current);
  useEffect(() => {
    const onPop = () => setPage(current());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return page;
}

/** The Insights page's sections, for the sub-navigation in the top bar. */
export const INSIGHT_SECTIONS = [
  { id: "categories", label: "Categories" },
  { id: "trips", label: "Events & trips" },
  { id: "food", label: "Food" },
  { id: "habits", label: "Habits" },
];

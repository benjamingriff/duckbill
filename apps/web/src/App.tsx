import { useMemo, useState } from "react";
import type { Category, Overview as OverviewData } from "@duckbill/api/types";
import { useJson } from "./api.ts";
import { AccountMenu } from "./auth.tsx";
import { CategoryContext } from "./categories.ts";
import { Loaded } from "./components/ui.tsx";
import { formatMonth, relativeTime } from "./format.ts";
import { Insights } from "./pages/Insights.tsx";
import { Overview } from "./pages/Overview.tsx";
import { Plan } from "./pages/Plan.tsx";
import { Transactions } from "./pages/Transactions.tsx";
import { INSIGHT_SECTIONS, navigate, PAGES, usePage } from "./route.ts";

export function App() {
  const page = usePage();
  // Every month, so the Overview's range tabs and month switcher need no refetch.
  const overview = useJson<OverviewData>("/api/overview?months=240");
  const categories = useJson<Category[]>("/api/categories");
  const categoryMap = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.category, c])),
    [categories.data],
  );
  const [pickedMonth, setPickedMonth] = useState<string | null>(null);

  const months = overview.data?.months ?? [];
  const latest = months.at(-1);
  const month = months.find((m) => m.month === pickedMonth) ?? latest;
  const index = month ? months.indexOf(month) : -1;
  const status = overview.data?.status;
  const isDemo = status?.dataDir.endsWith("data-demo") || status?.dataDir.endsWith("data-ci");
  // Every category for the Transactions filter, busiest spending first.
  const filterCategories = useMemo(() => {
    const totals = new Map<string, number>();
    for (const c of overview.data?.categories ?? []) {
      totals.set(c.category, (totals.get(c.category) ?? 0) + c.spendPence);
    }
    return [...categoryMap.keys()].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
  }, [overview.data, categoryMap]);

  return (
    <CategoryContext value={categoryMap}>
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            duck<b>bill</b>
          </div>
          <nav className="nav" aria-label="Pages">
            {PAGES.map((p) => (
              <a
                key={p.path}
                href={p.path}
                aria-current={p.path === page ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(p.path);
                }}
              >
                {p.label}
              </a>
            ))}
          </nav>
          {page === "/insights" && (
            <nav className="subnav" aria-label="Insights sections">
              {INSIGHT_SECTIONS.map((s) => (
                <a key={s.id} href={`#${s.id}`}>
                  {s.label}
                </a>
              ))}
            </nav>
          )}
          <div className="spacer" />
          <div className="meta">
            {page === "/" && month && (
              <>
                <div className="month-switch">
                  <button
                    type="button"
                    aria-label="Previous month"
                    disabled={index <= 0}
                    onClick={() => setPickedMonth(months[index - 1]?.month ?? null)}
                  >
                    ‹
                  </button>
                  <span>{formatMonth(month.month)}</span>
                  <button
                    type="button"
                    aria-label="Next month"
                    disabled={index >= months.length - 1}
                    onClick={() => setPickedMonth(months[index + 1]?.month ?? null)}
                  >
                    ›
                  </button>
                </div>
                <span className="divider-v" />
              </>
            )}
            {isDemo && <span className="badge">demo data</span>}
            {status?.lastSyncedAt && (
              <span className="synced" title={status.lastSyncedAt}>
                Synced {relativeTime(status.lastSyncedAt)}
              </span>
            )}
            <AccountMenu />
          </div>
        </header>

        <main>
          {page === "/" && (
            <Loaded data={overview}>
              {(o) =>
                month ? (
                  <Overview
                    overview={o}
                    month={month}
                    isCurrentMonth={month === latest}
                    onSelectMonth={setPickedMonth}
                  />
                ) : (
                  <div className="empty">No transactions yet.</div>
                )
              }
            </Loaded>
          )}
          {page === "/transactions" && <Transactions categoryKeys={filterCategories} />}
          {page === "/insights" && <Insights />}
          {page === "/plan" && <Plan />}
        </main>

        <footer className="footer">
          <span>Monzo{isDemo ? " · demo data" : ""}</span>
          {status?.lastSyncedAt && <span>Synced {relativeTime(status.lastSyncedAt)}</span>}
        </footer>
      </div>
    </CategoryContext>
  );
}

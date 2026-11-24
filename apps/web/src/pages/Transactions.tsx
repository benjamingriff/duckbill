import { useEffect, useRef, useState } from "react";
import type { TransactionDetail, TransactionRow, TransactionSearch } from "@duckbill/api/types";
import { useJson } from "../api.ts";
import { useCategory } from "../categories.ts";
import { Dot, Loaded, SetupState } from "../components/ui.tsx";
import {
  formatDayHeading,
  formatDayShort,
  formatMonthShort,
  formatMonthYearShort,
  isoDay,
  moneyExact,
  plural,
  signedExact,
  weekdayName,
} from "../format.ts";
import { seasonShade } from "../seasons.ts";

const RANGES = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
  { value: "all", label: "All time" },
];

const AMOUNTS = [
  { value: 0, label: "Any amount" },
  { value: 5, label: "More than £5" },
  { value: 20, label: "More than £20" },
  { value: 50, label: "More than £50" },
  { value: 100, label: "More than £100" },
];

const PAGE = 100;

function searchUrl(q: string, range: string, category: string, min: number, limit: number) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (q) params.set("q", q);
  if (range !== "all") {
    const from = new Date();
    from.setDate(from.getDate() - Number(range));
    params.set("from", isoDay(from));
  }
  if (category) params.set("category", category);
  if (min) params.set("min", String(min * 100 + 1));
  return `/api/transactions?${params}`;
}

/** Text search, filters and a results summary over every transaction. */
export function Transactions({ categoryKeys }: { categoryKeys: string[] }) {
  const category = useCategory();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [range, setRange] = useState("90");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [min, setMin] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  // The payment picked in the current search; a new search or filter clears it.
  const [selection, setSelection] = useState<{ id: string; search: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Search as you type, once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(text.trim());
      setLimit(PAGE);
    }, 250);
    return () => clearTimeout(timer);
  }, [text]);

  // "/" jumps to the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== input.current) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const search = searchUrl(q, range, categoryFilter, min, PAGE);
  const results = useJson<TransactionSearch>(searchUrl(q, range, categoryFilter, min, limit));
  const selected = selection?.search === search ? selection.id : null;
  const setSelected = (id: string | null) => setSelection(id ? { id, search } : null);
  const firstId = results.state === "ready" ? (results.data.rows[0]?.id ?? null) : null;
  const shownId = selected ?? (window.matchMedia("(min-width: 901px)").matches ? firstId : null);

  return (
    <>
      <label className="search">
        <span aria-hidden className="muted">
          ⌕
        </span>
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='Search payees and notes · try "pret >5" or "<20"'
          aria-label="Search transactions"
        />
        <kbd>/</kbd>
      </label>

      <div className="chips">
        <span className="chip on">
          <select
            value={range}
            onChange={(e) => {
              setRange(e.target.value);
              setLimit(PAGE);
            }}
            aria-label="Date range"
          >
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          ▾
        </span>
        <span className={`chip${categoryFilter ? " on" : ""}`}>
          {categoryFilter && <Dot colour={category(categoryFilter).colour} />}
          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setLimit(PAGE);
            }}
            aria-label="Category"
          >
            <option value="">Category</option>
            {categoryKeys.map((key) => (
              <option key={key} value={key}>
                {category(key).label}
              </option>
            ))}
          </select>
          {categoryFilter ? (
            <button
              type="button"
              aria-label="Clear category"
              onClick={() => setCategoryFilter("")}
              style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }}
            >
              ×
            </button>
          ) : (
            "▾"
          )}
        </span>
        <span className={`chip${min ? " on" : ""}`}>
          <select
            value={min}
            onChange={(e) => {
              setMin(Number(e.target.value));
              setLimit(PAGE);
            }}
            aria-label="Amount"
          >
            {AMOUNTS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          ▾
        </span>
        <button type="button" className="chip" disabled title="Tags and events come with editing">
          Tag or event
        </button>
        <button type="button" className="chip" disabled title="Your own categories come next">
          Uncategorised only
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="chip" disabled title="Saved views come with editing">
          Save as view
        </button>
      </div>

      <Loaded data={results}>
        {(r) => (
          <>
            <Summary results={r} />
            <div className="tx-layout">
              <div className="tx-table">
                <div className="tx-head">
                  <span>Merchant</span>
                  <span>Category</span>
                  <span>Tag / event</span>
                  <span style={{ textAlign: "right" }}>Amount</span>
                </div>
                {r.rows.length === 0 && <div className="empty">Nothing matches.</div>}
                {groupByDay(r.rows).map(([day, rows]) => (
                  <div key={day}>
                    <div className="tx-day">
                      <span>{formatDayHeading(day)}</span>
                      <span className="mono">
                        {signedExact(rows.reduce((s, t) => s + t.amountPence, 0))}
                      </span>
                    </div>
                    {rows.map((t) => (
                      <Row
                        key={t.id}
                        tx={t}
                        selected={t.id === shownId}
                        onSelect={() => setSelected(t.id)}
                      />
                    ))}
                  </div>
                ))}
                {r.rows.length < r.total && (
                  <div className="more">
                    <button
                      type="button"
                      className="chip"
                      onClick={() => setLimit((l) => Math.min(l + PAGE, 500))}
                      disabled={limit >= 500}
                    >
                      {limit >= 500
                        ? `Showing the newest 500 of ${r.total}. Narrow the search for more.`
                        : `Show more (${r.total - r.rows.length} left)`}
                    </button>
                  </div>
                )}
              </div>
              {shownId && (
                <Detail id={shownId} open={selected !== null} onClose={() => setSelected(null)} />
              )}
            </div>
          </>
        )}
      </Loaded>
    </>
  );
}

function groupByDay(rows: TransactionRow[]): [string, TransactionRow[]][] {
  const days = new Map<string, TransactionRow[]>();
  for (const row of rows) days.set(row.date, [...(days.get(row.date) ?? []), row]);
  return [...days.entries()];
}

function Summary({ results }: { results: TransactionSearch }) {
  const max = Math.max(...results.buckets.map((b) => b.spendPence), 1);
  const first = results.buckets[0]?.start;
  const last = results.buckets.at(-1)?.start;
  return (
    <div className="stats">
      <div className="stat">
        <span className="k">Results</span>
        <span className="v">{results.total.toLocaleString("en-GB")}</span>
      </div>
      <div className="stat">
        <span className="k">Spent</span>
        <span className="v">{moneyExact(results.spendPence)}</span>
      </div>
      <div className="stat">
        <span className="k">Average</span>
        <span className="v">
          {results.averageSpendPence === null ? "–" : moneyExact(results.averageSpendPence)}
        </span>
      </div>
      <div className="stat">
        <span className="k">Busiest day</span>
        <span className="v">
          {results.busiestWeekday ? weekdayName(results.busiestWeekday) : "–"}
        </span>
      </div>
      {results.buckets.length > 1 && first && last && (
        <div className="spark" aria-hidden>
          <div className="plot">
            {results.buckets.slice(-26).map((b) => (
              <span
                key={b.start}
                style={{ height: `${(Math.max(b.spendPence, 0) / max) * 100}%` }}
              />
            ))}
          </div>
          <span className="k">
            per {results.bucket} · {formatMonthShort(first)} → {formatMonthShort(last)}
          </span>
        </div>
      )}
    </div>
  );
}

const SCHEMES: Record<string, string> = {
  mastercard: "Card",
  bacs: "Direct debit",
  payport_faster_payments: "Bank transfer",
  p2p_payment: "Paid to a contact",
  monzo_to_monzo: "Monzo to Monzo",
  uk_retail_pot: "Pot transfer",
  monzo_flex: "Flex",
};

const RECURRING = {
  direct_debit: "Direct debit",
  standing_order: "Standing order",
  subscription: "Subscription",
};

function Row({
  tx,
  selected,
  onSelect,
}: {
  tx: TransactionRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const category = useCategory();
  const cat = category(tx.category);
  const sub = tx.notes;
  return (
    <button type="button" className="tx-row" aria-current={selected} onClick={onSelect}>
      <span className="who">
        <div>{tx.payeeName}</div>
        {(sub || tx.isPending) && (
          <div className="sub">
            {[tx.isPending ? "Pending" : null, sub].filter(Boolean).join(" · ")}
          </div>
        )}
      </span>
      <span className="cat">
        <Dot colour={cat.colour} />
        {cat.label}
      </span>
      <span className="tagcell">
        {tx.tripCity ? (
          <span className="tag trip">◆ {tx.tripCity} trip</span>
        ) : tx.recurringKind ? (
          <span className="tag">{RECURRING[tx.recurringKind]}</span>
        ) : (
          <span className="faint">—</span>
        )}
      </span>
      <span className={`amount${tx.amountPence > 0 ? " in" : ""}`}>
        {signedExact(tx.amountPence)}
      </span>
    </button>
  );
}

/** The selected payment, and your history with its payee. A sheet on phones. */
function Detail({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const detail = useJson<TransactionDetail>(`/api/transactions/${encodeURIComponent(id)}`);
  return (
    <aside className={`detail${open ? " open" : ""}`} aria-label="Transaction detail">
      <div className="detail-close">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <Loaded data={detail}>{(d) => <DetailBody detail={d} />}</Loaded>
    </aside>
  );
}

function DetailBody({ detail }: { detail: TransactionDetail }) {
  const category = useCategory();
  const { transaction: tx, payee } = detail;
  const cat = category(tx.category);
  const time = tx.createdAt.slice(11, 16);
  const foreign =
    tx.localCurrency !== "GBP" ? ` · ${minorUnits(tx.localAmountMinor, tx.localCurrency)}` : "";
  const max = Math.max(...payee.quarters.map((q) => q.spendPence), 1);

  return (
    <>
      <div>
        <h3>{tx.payeeName}</h3>
        <div className="when">
          {formatDayShort(tx.date)} · {time} · {SCHEMES[tx.scheme] ?? tx.scheme}
          {foreign}
          {tx.isPending ? " · Pending" : ""}
        </div>
      </div>
      <div className={`big${tx.amountPence > 0 ? " amount in" : ""}`}>
        {signedExact(tx.amountPence)}
      </div>

      <div className="fields">
        <div className="field">
          <span className="k">Category</span>
          <span className="v cat">
            <Dot colour={cat.colour} />
            {cat.label}
          </span>
        </div>
        <div className="field">
          <span className="k">Tags</span>
          <span className="v soon">Comes with editing</span>
        </div>
        <div className="field">
          <span className="k">Event</span>
          {tx.tripCity ? (
            <span className="v tag trip">◆ {tx.tripCity} trip</span>
          ) : (
            <span className="v soon">Comes with events</span>
          )}
        </div>
        <div className="field">
          <span className="k">Split</span>
          <span className={`v${tx.hasSplitBill ? "" : " soon"}`}>
            {tx.hasSplitBill ? "Split with Monzo" : "Comes with splits"}
          </span>
        </div>
        <div className="field">
          <span className="k">Note</span>
          <span className="v">{tx.notes ?? "—"}</span>
        </div>
      </div>

      {payee.visits > 0 && payee.firstDate && (
        <div>
          <h2 style={{ fontSize: 14 }}>You and {tx.payeeName}</h2>
          <p className="caption" style={{ color: "var(--fg-2)", lineHeight: "20px" }}>
            {plural(payee.visits, "payment")} since {formatMonthYearShort(payee.firstDate)} ·{" "}
            <b style={{ color: "var(--fg)" }}>{moneyExact(payee.totalPence)} total</b>
            {payee.averagePence !== null && ` · ${moneyExact(payee.averagePence)} on average`}
          </p>
          {payee.quarters.length > 1 && (
            <>
              <div className="history-bars" style={{ marginTop: 16 }} aria-hidden>
                {payee.quarters.slice(-16).map((q) => (
                  <span
                    key={q.start}
                    title={`${formatMonthYearShort(q.start)}: ${moneyExact(q.spendPence)}`}
                    style={{
                      height: `${(Math.max(q.spendPence, 0) / max) * 100}%`,
                      background: seasonShade(q.start),
                    }}
                  />
                ))}
              </div>
              <div className="faint mono" style={{ fontSize: 11, marginTop: 8 }}>
                by quarter, coloured by season
              </div>
            </>
          )}
        </div>
      )}

      <SetupState title={`Always file ${tx.payeeName} as ${cat.label}?`}>
        Rules, and quick actions to change a payment's category, event or split, come with editing.
      </SetupState>
    </>
  );
}

/** A foreign amount in minor units, formatted for its currency (yen have none). */
function minorUnits(amount: number, currency: string): string {
  try {
    const format = new Intl.NumberFormat("en-GB", { style: "currency", currency });
    const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
    return format.format(Math.abs(amount) / 10 ** digits);
  } catch {
    return `${Math.abs(amount)} ${currency}`; // not an ISO currency code
  }
}

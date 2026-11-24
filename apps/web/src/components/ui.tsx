import type { ReactNode } from "react";
import type { Loadable } from "../api.ts";

/**
 * The placeholder for anything that needs data you haven't entered yet: a
 * plan, goals, debts, events or edits. Says what it will show, never fake numbers.
 */
export function SetupState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="setup">
      <strong>{title}</strong>
      {children}
      <div>
        <span className="soon">Set up · coming soon</span>
      </div>
    </div>
  );
}

interface Option<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
}

/** Underlined text tabs, e.g. Season / Category or 6M / 12M. */
export function Tabs<T extends string | number>({
  label,
  options,
  value,
  onChange,
  showLabel = false,
}: {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  showLabel?: boolean;
}) {
  return (
    <div className="tabs" role="group" aria-label={label}>
      {showLabel && <span className="label">{label}</span>}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Dot({ colour }: { colour: string }) {
  return <span className="dot" style={{ background: colour }} aria-hidden />;
}

/** Renders `children` with the data once loaded, or a loading/error state. */
export function Loaded<T>({
  data,
  children,
}: {
  data: Loadable<T>;
  children: (data: T) => ReactNode;
}) {
  if (data.state === "error" && data.data === undefined) {
    return (
      <div className="error" role="alert">
        {data.error.message}
        {data.error.hint && <p>{data.error.hint}</p>}
      </div>
    );
  }
  if (data.data === undefined) return <div className="empty">Loading…</div>;
  return (
    <div style={{ opacity: data.state === "loading" ? 0.6 : 1, transition: "opacity 120ms" }}>
      {children(data.data)}
    </div>
  );
}

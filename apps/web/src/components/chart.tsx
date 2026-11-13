// Shared Recharts styling so every chart has the same recessive axes and grid.

export const AXIS_TICK = { fill: "#77716c", fontSize: 12 } as const;
export const GRID_STROKE = "#1c1a18";
export const SURFACE = "#0d0b0a";
export const ACCENT = "#c5ac98";

export function Swatch({ color }: { color: string }) {
  return <span className="swatch" style={{ background: color }} aria-hidden />;
}

export function Legend({ items }: { items: { label: string; color: string; title?: string }[] }) {
  return (
    <div className="legend">
      {items.map((item) => (
        <span key={item.label} title={item.title}>
          <Swatch color={item.color} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

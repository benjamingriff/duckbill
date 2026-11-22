interface Option<T extends string | number> {
  value: T;
  label: string;
}

interface Props<T extends string | number> {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: Props<T>) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

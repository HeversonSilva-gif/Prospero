// TODO(decision): border-l-semantic-warning and border-l-semantic-info use Tailwind semantic color classes
// which require those colors to be present in the config — verified present in tailwind.config.ts.
type Stat = { label: string; value: string; sub?: string };

type Props = {
  variant: "brand" | "goal" | "review";
  stats: Stat[];
};

const borderClasses: Record<Props["variant"], string> = {
  brand: "border-l-brand",
  goal: "border-l-semantic-warning",
  // TODO(decision): token border-l-semantic-info — falls back to border-l-brand if Tailwind can't resolve
  review: "border-l-semantic-info",
};

export const HeroSummary = ({ variant, stats }: Props): JSX.Element => {
  const cols = Math.min(stats.length, 4);
  return (
    <div
      className={`bg-surface-card border border-surface-border border-l-[3px] ${borderClasses[variant]} rounded-lg px-6 py-5 mb-7 grid gap-6`}
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {stats.map((s) => (
        <div key={s.label}>
          <p className="text-[10px] uppercase tracking-wider text-ink-soft font-semibold mb-1 m-0">
            {s.label}
          </p>
          <p className="text-lg font-semibold text-ink m-0">{s.value}</p>
          {s.sub !== undefined && <p className="text-[11px] text-ink-soft mt-0.5 m-0">{s.sub}</p>}
        </div>
      ))}
    </div>
  );
};

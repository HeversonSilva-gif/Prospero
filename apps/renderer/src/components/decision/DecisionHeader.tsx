import { Chip, type ChipVariant } from "./Chip.js";

type Props = {
  chip: { variant: ChipVariant; label: string };
  meta: string;
  title: string;
  compact?: boolean;
};

export const DecisionHeader = ({ chip, meta, title, compact = false }: Props): JSX.Element => (
  <div>
    <div className="flex items-center gap-3 mb-1.5 flex-wrap">
      <Chip variant={chip.variant}>{chip.label}</Chip>
      <span className="text-xs text-ink-soft">{meta}</span>
    </div>
    <h1
      className={
        compact
          ? "text-xl font-bold leading-tight text-ink mb-4 m-0"
          : "text-2xl font-bold leading-tight text-ink mb-7 m-0"
      }
    >
      {title}
    </h1>
  </div>
);

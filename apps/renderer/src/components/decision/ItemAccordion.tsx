import { type ReactNode, useState } from "react";

type Badge = { label: string; tone: "high" | "medium" | "low" | "model" };
type Avatar = { variant: "person" | "role" | "issue"; label: string };

export type AccordionItem = {
  id: string;
  avatar: Avatar;
  name: string;
  sub?: ReactNode;
  badges?: Badge[];
  body?: ReactNode;
};

const avatarClasses: Record<Avatar["variant"], string> = {
  person:
    "w-8 h-8 rounded-full bg-gradient-to-br from-brand to-brand-dark text-white font-semibold text-xs flex items-center justify-center flex-shrink-0",
  role: "w-8 h-8 rounded-md bg-semantic-warning-bg text-semantic-warning font-semibold text-xs flex items-center justify-center flex-shrink-0",
  issue:
    "w-8 h-8 rounded bg-surface-soft text-ink-muted text-[10px] font-mono flex items-center justify-center flex-shrink-0",
};

const badgeClasses: Record<Badge["tone"], string> = {
  high: "bg-semantic-danger-bg text-semantic-danger",
  medium: "bg-brand-bg text-brand",
  low: "bg-surface-soft text-ink-soft",
  model: "bg-surface-soft text-ink-muted border border-surface-border",
};

const Row = ({ item }: { item: AccordionItem }): JSX.Element => {
  const [open, setOpen] = useState(false);
  const collapsible = item.body !== undefined;

  return (
    <div className="bg-surface-card border border-surface-border rounded-md mb-1.5 overflow-hidden transition-colors hover:border-ink-soft">
      <div
        className={`flex items-center gap-3.5 px-4 py-3.5 ${collapsible ? "cursor-pointer" : ""}`}
        onClick={collapsible ? () => setOpen((v) => !v) : undefined}
        role={collapsible ? "button" : undefined}
        tabIndex={collapsible ? 0 : undefined}
        onKeyDown={
          collapsible
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") setOpen((v) => !v);
              }
            : undefined
        }
      >
        <div className={avatarClasses[item.avatar.variant]}>{item.avatar.label}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink m-0">{item.name}</p>
          {item.sub !== undefined && <p className="text-xs text-ink-soft mt-0.5 m-0">{item.sub}</p>}
        </div>
        {(item.badges ?? []).length > 0 && (
          <div className="flex gap-2 items-center flex-shrink-0">
            {(item.badges ?? []).map((b) => (
              <span
                key={b.label}
                className={`text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wide ${badgeClasses[b.tone]}`}
              >
                {b.label}
              </span>
            ))}
          </div>
        )}
        {collapsible && (
          <svg
            className={`w-3 h-3 text-ink-soft flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
            viewBox="0 0 12 12"
            fill="none"
          >
            <path
              d="M4 2l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
      {collapsible && open && (
        <div className="px-4 pb-4 border-t border-surface-border bg-surface">{item.body}</div>
      )}
    </div>
  );
};

type Props = { items: AccordionItem[] };

export const ItemAccordion = ({ items }: Props): JSX.Element => (
  <div>
    {items.map((item) => (
      <Row key={item.id} item={item} />
    ))}
  </div>
);

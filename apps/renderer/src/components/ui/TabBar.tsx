import type { FC } from "react";

export type TabBarTab = { id: string; label: string; badge?: number };

type Props = {
  tabs: TabBarTab[];
  active: string;
  onSelect: (id: string) => void;
  variant: "segmented" | "underline";
};

export const TabBar: FC<Props> = ({ tabs, active, onSelect, variant }) => {
  if (variant === "segmented") {
    return (
      <div className="inline-flex gap-0.5 p-0.5 bg-surface-soft rounded">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            className={`px-3 py-1 text-xs font-medium rounded flex items-center gap-1.5 ${
              active === tab.id
                ? "bg-surface-card text-brand shadow-sm"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="text-[10px] bg-surface-border text-ink-muted px-1.5 py-0.5 rounded-full">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="flex border-b border-surface-border">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onSelect(tab.id)}
          className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px flex items-center gap-1.5 ${
            active === tab.id
              ? "border-brand text-brand"
              : "border-transparent text-ink-muted hover:text-ink"
          }`}
        >
          {tab.label}
          {tab.badge !== undefined && tab.badge > 0 && (
            <span className="text-[10px] bg-surface-soft text-ink-muted px-1.5 py-0.5 rounded-full">
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
};

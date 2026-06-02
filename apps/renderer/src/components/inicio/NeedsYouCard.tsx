import type { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bell } from "@phosphor-icons/react";
import type { BriefingItem } from "@prospero/shared";

type Props = { items: BriefingItem[] };

export const NeedsYouCard: FC<Props> = ({ items }) => {
  const { t } = useTranslation();
  if (items.length === 0) {
    return (
      <div className="bg-surface-card border border-surface-border rounded-2xl px-5 py-6">
        <p className="text-sm text-ink-muted text-center">{t("inicio.precisaDeVoceEmpty")}</p>
      </div>
    );
  }
  const [first, ...rest] = items;
  return (
    <div className="bg-surface-card border border-brand-soft rounded-2xl p-5 shadow-[0_2px_10px_-4px_rgba(15,118,110,.18)]">
      <div className="flex items-center gap-3">
        <span
          className="w-10 h-10 rounded-xl bg-brand-bg text-brand flex items-center justify-center flex-shrink-0"
          aria-hidden="true"
        >
          <Bell size={20} weight="fill" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink truncate">{first!.label}</p>
          {first!.detail !== "" && (
            <p className="text-xs text-ink-muted truncate">{first!.detail}</p>
          )}
        </div>
        <Link
          to={first!.route}
          className="text-[13px] font-semibold px-5 py-2.5 rounded-lg bg-brand text-brand-fg whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          {t("inicio.verButton")}
        </Link>
      </div>
      {rest.length > 0 && (
        <p className="mt-3 text-[11px] font-mono text-ink-muted">
          {t("inicio.maisDecisoes", { count: rest.length })}
        </p>
      )}
    </div>
  );
};

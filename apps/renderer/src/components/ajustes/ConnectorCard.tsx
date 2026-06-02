import type { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  icon: ReactNode;
  name: string;
  unlocks: string;
  connected: boolean;
  detail?: string;
  onAction: () => void;
};

export const ConnectorCard: FC<Props> = ({ icon, name, unlocks, connected, detail, onAction }) => {
  const { t } = useTranslation();
  return (
    <div className="bg-surface-card border border-surface-border rounded-2xl p-4">
      <div className="flex items-center gap-3">
        <span
          className="w-9 h-9 rounded-lg bg-surface-soft text-ink-muted flex items-center justify-center flex-shrink-0"
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink">{name}</div>
          <div className="text-[11px] text-ink-muted truncate">{unlocks}</div>
        </div>
        <span
          className={`text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${
            connected ? "text-brand bg-brand-bg" : "text-risk-warn-fg bg-risk-warn-bg"
          }`}
        >
          {connected ? t("ajustes.conexoes.connected") : t("ajustes.conexoes.connect")}
        </span>
      </div>
      <div className="flex items-center mt-3 pt-3 border-t border-surface-border">
        <span className="text-[10px] font-mono text-ink-muted truncate">{detail ?? "—"}</span>
        <button
          type="button"
          onClick={onAction}
          className={`ml-auto text-[11px] font-semibold px-3 py-1.5 rounded-lg ${
            connected ? "text-brand border border-brand-soft" : "bg-brand text-brand-fg"
          }`}
        >
          {connected ? t("ajustes.conexoes.manage") : t("ajustes.conexoes.connectBtn")}
        </button>
      </div>
    </div>
  );
};

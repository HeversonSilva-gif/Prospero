import { type FC } from "react";
import { useTranslation } from "react-i18next";
import type { PermissionRequest } from "@dashboard-agent/shared";

type Props = {
  request: PermissionRequest;
  onResolve: (allow: boolean) => void;
};

export const ApprovalCard: FC<Props> = ({ request, onResolve }) => {
  const { t } = useTranslation();
  return (
    <div className="mx-6 my-2 rounded border-l-4 border-l-semantic-warning bg-surface-card p-3">
      <header className="text-xs font-semibold text-brand-dark mb-2">
        {t("approval.toolCall", { name: request.toolName })}
      </header>
      <pre className="text-[11px] font-mono bg-surface-soft p-2 rounded overflow-x-auto whitespace-pre-wrap break-words max-h-32">
        {JSON.stringify(request.toolInput, null, 2)}
      </pre>
      <div className="flex gap-2 mt-2">
        <button
          onClick={() => onResolve(true)}
          type="button"
          className="text-xs px-3 py-1 bg-semantic-success text-white rounded font-semibold"
        >
          {t("approval.approve")}
        </button>
        <button
          onClick={() => onResolve(false)}
          type="button"
          className="text-xs px-3 py-1 bg-semantic-danger text-white rounded font-semibold"
        >
          {t("approval.reject")}
        </button>
      </div>
    </div>
  );
};

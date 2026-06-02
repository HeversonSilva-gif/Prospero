import type { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CheckCircle } from "@phosphor-icons/react";
import type { BriefingItem } from "@prospero/shared";

type Props = { items: BriefingItem[] };

export const HojeTimeline: FC<Props> = ({ items }) => {
  const { t } = useTranslation();
  if (items.length === 0) {
    return <p className="text-sm text-ink-muted px-1 py-2">{t("inicio.hojeEmpty")}</p>;
  }
  return (
    <div className="flex flex-col">
      {items.map((item) => (
        <Link
          key={item.id}
          to={item.route}
          className="flex items-start gap-3 py-2 px-1 rounded-lg hover:bg-surface-soft"
        >
          <CheckCircle size={16} className="text-brand mt-0.5 flex-shrink-0 opacity-70" />
          <span className="text-[13px] text-ink min-w-0">
            <span className="font-medium">{item.label}</span>
            {item.detail !== "" && <span className="text-ink-muted"> · {item.detail}</span>}
          </span>
        </Link>
      ))}
    </div>
  );
};

import type { ComponentType } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CompanySwitcher } from "../CompanySwitcher.js";
import { SidebarFooter } from "../SidebarFooter.js";
import {
  HomeIcon,
  SparklesIcon,
  DecisionsIcon,
  FolderIcon,
  UsersIcon,
  SettingsIcon,
  FinanceIcon,
} from "./sidebar-icons.js";

// Estúdio redesign — sidebar with Phosphor icons + Decisões item.
// CompanySwitcher and SidebarFooter are intentionally untouched (out of scope).

type NavItem = {
  to: string;
  labelKey: string;
  Icon: ComponentType<{ className?: string | undefined }>;
  end?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { to: "/briefing", labelKey: "nav.inicio", Icon: HomeIcon },
  { to: "/goals/new", labelKey: "nav.pedirAlgo", Icon: SparklesIcon },
  { to: "/inbox", labelKey: "nav.decisoes", Icon: DecisionsIcon },
  { to: "/projects", labelKey: "nav.projetos", Icon: FolderIcon },
  { to: "/financeiro", labelKey: "nav.financeiro", Icon: FinanceIcon },
  { to: "/agents", labelKey: "nav.equipe", Icon: UsersIcon, end: true },
  { to: "/settings", labelKey: "nav.ajustes", Icon: SettingsIcon },
];

export const Sidebar: ComponentType = () => {
  const { t } = useTranslation();
  return (
    <aside className="w-56 bg-surface-card border-r border-surface-border flex flex-col p-3">
      <h1 className="px-2 mb-4 text-sm font-bold text-brand-dark">{t("app.title")}</h1>
      <div className="px-2 mb-3">
        <CompanySwitcher />
      </div>
      <nav className="flex flex-col gap-1 text-sm text-ink-muted">
        {NAV_ITEMS.map(({ to, labelKey, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            {...(end ? { end } : {})}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-2.5 py-2 rounded-lg font-medium ${
                isActive
                  ? "bg-brand-bg text-brand"
                  : "text-ink-muted hover:bg-surface-soft hover:text-ink"
              }`
            }
          >
            <Icon className="flex-shrink-0" />
            <span>{t(labelKey)}</span>
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto">
        <SidebarFooter />
      </div>
    </aside>
  );
};

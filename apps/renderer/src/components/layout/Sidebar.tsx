import type { FC } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CompanySwitcher } from "../CompanySwitcher.js";
import { SidebarFooter } from "../SidebarFooter.js";
import { HomeIcon, SparklesIcon, FolderIcon, UsersIcon, SettingsIcon } from "./sidebar-icons.js";

// M16 PR-A1 — sidebar reduzida de 11 para 5 itens.
// Não renderiza a lista de agentes (agentes vivem em "Minha equipe" agora).
// Routes apontam para superfícies existentes — sem alteração de roteamento neste PR.

type NavItem = {
  to: string;
  labelKey: string;
  Icon: FC<{ className?: string }>;
  end?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { to: "/briefing", labelKey: "nav.inicio", Icon: HomeIcon },
  { to: "/goals/new", labelKey: "nav.pedirAlgo", Icon: SparklesIcon },
  { to: "/projects", labelKey: "nav.projetos", Icon: FolderIcon },
  { to: "/agents", labelKey: "nav.equipe", Icon: UsersIcon, end: true },
  { to: "/settings", labelKey: "nav.ajustes", Icon: SettingsIcon },
];

export const Sidebar: FC = () => {
  const { t } = useTranslation();
  return (
    <aside className="w-56 bg-surface border-r border-surface-border flex flex-col p-3">
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
              `flex items-center gap-2.5 px-2.5 py-2 rounded-md font-medium ${
                isActive ? "bg-brand-bg text-brand" : "hover:bg-surface-soft hover:text-ink"
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

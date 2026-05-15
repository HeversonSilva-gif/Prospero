import { useEffect, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useRolesStore } from "../stores/roles.js";
import { RoleListItem } from "../components/roles/RoleListItem.js";
import { RoleDetail } from "../components/roles/RoleDetail.js";

export const Roles: FC = () => {
  const { t } = useTranslation();
  const roles = useRolesStore((s) => s.roles);
  const selectedId = useRolesStore((s) => s.selectedId);
  const selectedDetail = useRolesStore((s) => s.selectedDetail);
  const loaded = useRolesStore((s) => s.loaded);
  const load = useRolesStore((s) => s.load);
  const select = useRolesStore((s) => s.select);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full">
      <aside className="w-60 border-r border-surface-border bg-surface-card flex flex-col">
        <header className="px-4 py-3 border-b border-surface-border">
          <h1 className="text-sm font-bold text-brand-dark">{t("skills.title")}</h1>
          <p className="text-[11px] text-ink-muted mt-1">{t("skills.subtitle")}</p>
        </header>
        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {!loaded ? (
            <p className="text-xs text-ink-muted p-2">…</p>
          ) : roles.length === 0 ? (
            <p className="text-xs text-ink-muted p-2">{t("skills.empty")}</p>
          ) : (
            roles.map((r) => (
              <RoleListItem
                key={r.id}
                role={r}
                selected={r.id === selectedId}
                onSelect={() => void select(r.id)}
              />
            ))
          )}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto">
        {selectedDetail !== null && <RoleDetail detail={selectedDetail} />}
      </main>
    </div>
  );
};

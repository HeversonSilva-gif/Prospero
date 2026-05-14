import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useCompaniesStore } from "../stores/companies.js";
import { CreateCompanyModal } from "./CreateCompanyModal.js";
import { DeleteCompanyConfirm } from "./DeleteCompanyConfirm.js";

export const CompanySwitcher = () => {
  const { t } = useTranslation();
  const companies = useCompaniesStore((s) => s.companies);
  const activeId = useCompaniesStore((s) => s.activeId);
  const setActive = useCompaniesStore((s) => s.setActive);
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const active = companies.find((c) => c.id === activeId) ?? null;

  if (companies.length === 0) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="w-full px-2 py-1.5 text-xs font-semibold text-brand bg-brand-bg rounded hover:bg-brand-bg/80 border border-brand/20"
        >
          + {t("company.switcher.createFirst")}
        </button>
        {showCreate && <CreateCompanyModal onClose={() => setShowCreate(false)} />}
      </>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-2 py-1.5 text-xs font-semibold text-ink rounded hover:bg-surface-soft flex items-center justify-between gap-2 border border-surface-border"
      >
        <span className="truncate">{active?.name ?? t("company.switcher.placeholder")}</span>
        <span className="text-ink-soft">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 mt-1 z-10 bg-surface border border-surface-border rounded shadow-lg overflow-hidden">
          {companies.map((c) => (
            <div
              key={c.id}
              className={`flex items-center justify-between px-2 py-1.5 text-xs ${
                c.id === activeId ? "bg-brand-bg text-brand" : "hover:bg-surface-soft"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  void setActive(c.id);
                  setOpen(false);
                }}
                className="flex-1 text-left truncate"
              >
                {c.name}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingDeleteId(c.id);
                  setOpen(false);
                }}
                aria-label={t("company.switcher.deleteAria", { name: c.name })}
                className="ml-2 text-ink-soft hover:text-semantic-danger"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              setShowCreate(true);
              setOpen(false);
            }}
            className="w-full text-left px-2 py-1.5 text-xs text-brand font-medium hover:bg-surface-soft border-t border-surface-border"
          >
            + {t("company.switcher.create")}
          </button>
        </div>
      )}
      {showCreate && <CreateCompanyModal onClose={() => setShowCreate(false)} />}
      {pendingDeleteId !== null && (
        <DeleteCompanyConfirm
          companyId={pendingDeleteId}
          onClose={() => setPendingDeleteId(null)}
        />
      )}
    </div>
  );
};

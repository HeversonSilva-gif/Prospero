import { useCompaniesStore } from "../stores/companies.js";

// Single source of truth for "which company is the user looking at". Routes used
// to call companies.list()[0], which ignored the CompanySwitcher selection and
// could read/write the wrong company (relatorioCodex P1). This returns the
// active company id and is reactive — data effects keyed on it re-run when the
// user switches companies. Null until the companies store has loaded.
export const useActiveCompanyId = (): string | null => useCompaniesStore((s) => s.activeId);

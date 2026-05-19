import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { validateIsa } from "@prospero/shared";
import type { CriterionKind } from "@prospero/shared";
import { useIsaStore } from "../stores/isa.js";
import { Section, EmptyState, LoadingState } from "./ui/index.js";

// ISA authoring panel for the goal-detail screen. One textarea for the isa.md
// body (debounced auto-save, like InstructionsTab) + a criteria list. Live
// verification status is M13 PR-B — here every ISC shows as "pending".

export const IsaPanel: FC<{ goalId: string }> = ({ goalId }) => {
  const { t } = useTranslation();
  const store = useIsaStore();
  const [local, setLocal] = useState("");

  const { load, body, save } = store;

  useEffect(() => {
    void load(goalId);
  }, [goalId, load]);

  useEffect(() => {
    setLocal(body);
  }, [body]);

  // Debounced autosave. The `local === body` guard skips the no-op fired by
  // the body-sync effect (on mount and after a save round-trips back).
  useEffect(() => {
    if (local === body) return;
    const handle = setTimeout(() => {
      void save(local);
    }, 500);
    return () => clearTimeout(handle);
  }, [local, body, save]);

  const onBodyChange = (value: string): void => {
    setLocal(value);
  };

  if (store.loading) return <LoadingState label={t("isa.loading")} />;

  const validation = validateIsa(local);

  return (
    <div className="space-y-6">
      {store.error !== null && <p className="text-xs text-semantic-danger">{store.error}</p>}

      {store.draft !== null && (
        <div className="bg-surface-soft border border-surface-border rounded p-3 space-y-2">
          <p className="text-xs text-ink-muted">{t("isa.draftReady")}</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="px-3 py-1 text-xs rounded bg-brand text-brand-fg"
              onClick={() => void store.applyDraft()}
            >
              {t("isa.applyDraft")}
            </button>
            <button
              type="button"
              className="px-3 py-1 text-xs rounded border border-surface-border text-ink-muted"
              onClick={() => store.discardDraft()}
            >
              {t("isa.discardDraft")}
            </button>
          </div>
        </div>
      )}

      <Section
        title={t("isa.documentTitle")}
        hint={
          validation.ok
            ? t("isa.allSectionsPresent")
            : t("isa.missingSections", { sections: validation.missing.join(", ") })
        }
      >
        <textarea
          aria-label={t("isa.documentTitle")}
          className="w-full h-80 font-mono text-xs p-3 rounded border border-surface-border bg-surface-card text-ink resize-y"
          value={local}
          onChange={(e) => onBodyChange(e.target.value)}
          spellCheck={false}
        />
        <button
          type="button"
          className="mt-2 px-3 py-1 text-xs rounded border border-surface-border text-ink-muted disabled:opacity-50"
          disabled={store.generating}
          onClick={() => void store.generate()}
        >
          {store.generating ? t("isa.generating") : t("isa.generate")}
        </button>
      </Section>

      <Section title={t("isa.criteriaTitle")} hint={t("isa.criteriaHint")}>
        <IsaCriteriaList />
      </Section>
    </div>
  );
};

// The criteria list + an inline "add criterion" form.
const IsaCriteriaList: FC = () => {
  const { t } = useTranslation();
  const store = useIsaStore();
  const [statement, setStatement] = useState("");
  const [kind, setKind] = useState<CriterionKind>("judgment");

  const add = (): void => {
    if (statement.trim() === "") return;
    void store.addCriterion({
      statement: statement.trim(),
      kind,
      checkType: null,
      checkSpec: null,
    });
    setStatement("");
    setKind("judgment");
  };

  return (
    <div className="space-y-2">
      {store.criteria.length === 0 ? (
        <EmptyState message={t("isa.noCriteria")} />
      ) : (
        <ul className="space-y-1">
          {store.criteria.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 text-xs p-2 rounded border border-surface-border bg-surface-card"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-ink-soft shrink-0" aria-hidden />
              <span className="flex-1 text-ink">{c.statement}</span>
              <span className="text-[10px] uppercase tracking-wide text-ink-soft">
                {t(`isa.kind.${c.kind}`)}
              </span>
              <button
                type="button"
                className="text-ink-soft hover:text-semantic-danger"
                onClick={() => void store.removeCriterion(c.id)}
                aria-label={t("isa.removeCriterion")}
              >
                &#10005;
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          aria-label={t("isa.criterionPlaceholder")}
          className="flex-1 text-xs px-2 py-1 rounded border border-surface-border bg-surface-card text-ink"
          placeholder={t("isa.criterionPlaceholder")}
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <select
          className="text-xs px-2 py-1 rounded border border-surface-border bg-surface-card text-ink"
          value={kind}
          onChange={(e) => setKind(e.target.value as CriterionKind)}
        >
          <option value="judgment">{t("isa.kind.judgment")}</option>
          <option value="deterministic">{t("isa.kind.deterministic")}</option>
        </select>
        <button
          type="button"
          className="px-3 py-1 text-xs rounded bg-brand text-brand-fg"
          onClick={add}
        >
          {t("isa.addCriterion")}
        </button>
      </div>
    </div>
  );
};

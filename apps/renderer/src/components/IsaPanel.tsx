import { useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { validateIsa } from "@prospero/shared";
import type { CriterionKind, CriterionStatus, GoalCriterion } from "@prospero/shared";
import { useIsaStore } from "../stores/isa.js";
import { Section, EmptyState, LoadingState } from "./ui/index.js";

// Per-status visual config. Failed is loud (left accent + tinted bg) so it
// pulls the eye; passed is calm muted-ok; pending stays neutral; waived
// uses a dashed border + strikethrough to read as deliberately set aside.
type StatusStyle = {
  row: string;
  indicator: string;
  label: string;
  statement: string;
};
const STATUS_STYLES: Record<CriterionStatus, StatusStyle> = {
  failed: {
    row: "border border-semantic-danger/60 border-l-2 border-l-semantic-danger bg-semantic-danger-bg/40",
    indicator: "bg-semantic-danger",
    label: "text-semantic-danger",
    statement: "text-ink font-medium",
  },
  pending: {
    row: "border border-surface-border bg-surface-card",
    indicator: "bg-ink-soft",
    label: "text-ink-soft",
    statement: "text-ink",
  },
  passed: {
    row: "border border-surface-border bg-surface-card",
    indicator: "bg-semantic-success ring-2 ring-semantic-success/20",
    label: "text-semantic-success",
    statement: "text-ink-muted",
  },
  waived: {
    row: "border border-dashed border-surface-border bg-surface-card opacity-60",
    indicator: "bg-ink-soft",
    label: "text-ink-soft",
    statement: "text-ink-soft line-through",
  },
};

// Display order for groups — failed first to draw attention, waived last as
// the "set aside" bucket. Empty groups are skipped at render time.
const STATUS_ORDER: CriterionStatus[] = ["failed", "pending", "passed", "waived"];

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
      {store.error !== null && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-semantic-danger/40 bg-semantic-danger-bg/40 px-3 py-2"
        >
          <span
            className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 bg-semantic-danger"
            aria-hidden
          />
          <p className="text-xs text-semantic-danger flex-1">{store.error}</p>
        </div>
      )}

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

// One row in the grouped criteria list. Pulled out so the group renderer
// stays focused on grouping concerns.
const CriterionRow: FC<{ c: GoalCriterion }> = ({ c }) => {
  const { t } = useTranslation();
  const store = useIsaStore();
  const style = STATUS_STYLES[c.status];
  return (
    <li className={`flex items-start gap-2.5 text-xs px-3 py-2.5 rounded-md ${style.row}`}>
      <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${style.indicator}`} aria-hidden />
      <div className="flex-1 min-w-0 space-y-1">
        <p className={style.statement}>{c.statement}</p>
        <p className="flex items-center gap-2 text-[10px] uppercase tracking-wide">
          <span className={style.label}>{t(`isa.status.${c.status}`)}</span>
          <span className="text-ink-soft">·</span>
          <span className="text-ink-soft">{t(`isa.kind.${c.kind}`)}</span>
        </p>
      </div>
      {c.kind === "judgment" && c.status === "pending" && (
        <span className="flex gap-1 shrink-0">
          <button
            type="button"
            className="px-2 py-0.5 text-[10px] rounded border border-semantic-success/40 text-semantic-success bg-semantic-success/10 hover:bg-semantic-success/20"
            onClick={() => void store.judgeCriterion(c.id, "passed")}
          >
            {t("isa.judgePass")}
          </button>
          <button
            type="button"
            className="px-2 py-0.5 text-[10px] rounded border border-semantic-danger/40 text-semantic-danger bg-semantic-danger/10 hover:bg-semantic-danger/20"
            onClick={() => void store.judgeCriterion(c.id, "failed")}
          >
            {t("isa.judgeFail")}
          </button>
        </span>
      )}
      <button
        type="button"
        className="shrink-0 mt-0.5 text-ink-soft hover:text-semantic-danger"
        onClick={() => void store.removeCriterion(c.id)}
        aria-label={t("isa.removeCriterion")}
      >
        &#10005;
      </button>
    </li>
  );
};

// The criteria list + an inline "add criterion" form. Criteria are bucketed
// by status (failed first to draw attention; waived last as set-aside) and
// each non-empty bucket gets a small uppercase header with a count.
const IsaCriteriaList: FC = () => {
  const { t } = useTranslation();
  const store = useIsaStore();
  const [statement, setStatement] = useState("");
  const [kind, setKind] = useState<CriterionKind>("judgment");

  const grouped = useMemo(() => {
    const buckets: Record<CriterionStatus, GoalCriterion[]> = {
      failed: [],
      pending: [],
      passed: [],
      waived: [],
    };
    for (const c of store.criteria) buckets[c.status].push(c);
    return buckets;
  }, [store.criteria]);

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
    <div className="space-y-3">
      {store.criteria.length === 0 ? (
        <EmptyState message={t("isa.noCriteriaHint")} />
      ) : (
        <div className="space-y-3">
          {STATUS_ORDER.map((status) => {
            const items = grouped[status];
            if (items.length === 0) return null;
            return (
              <div key={status} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <h4
                    className={`text-[10px] uppercase tracking-wide font-semibold ${STATUS_STYLES[status].label}`}
                  >
                    {t(`isa.group.${status}`)}
                  </h4>
                  <span className="text-[10px] text-ink-soft tabular-nums">{items.length}</span>
                  <span className="flex-1 h-px bg-surface-border" aria-hidden />
                </div>
                <ul className="space-y-1.5">
                  {items.map((c) => (
                    <CriterionRow key={c.id} c={c} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-2 pt-1">
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

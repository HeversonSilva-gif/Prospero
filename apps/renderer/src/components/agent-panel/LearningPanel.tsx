import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Skill, Memory, SessionSearchHit } from "@prospero/shared";

interface Props {
  agentId: string;
  skills: Skill[];
  memories: Memory[];
}

type SubTab = "skills" | "memory" | "history";

const SUB_TABS: SubTab[] = ["skills", "memory", "history"];

export const LearningPanel: FC<Props> = ({ agentId, skills, memories }) => {
  const { t } = useTranslation();
  const [sub, setSub] = useState<SubTab>("skills");

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex gap-1 px-6 py-2 border-b border-surface-border">
        {SUB_TABS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSub(s)}
            className={`px-2.5 py-1 text-xs font-medium rounded ${
              sub === s
                ? "bg-brand text-brand-fg"
                : "bg-surface-soft text-ink-muted hover:bg-surface-border"
            }`}
          >
            {t(`agent.learning.subtabs.${s}`)}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        {sub === "skills" && <SkillsView skills={skills} />}
        {sub === "memory" && <MemoryView memories={memories} />}
        {sub === "history" && <HistoryView agentId={agentId} />}
      </div>
    </div>
  );
};

// --- Skills ---------------------------------------------------------------

const SkillsView: FC<{ skills: Skill[] }> = ({ skills }) => {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bodies, setBodies] = useState<Record<string, string>>({});

  const toggle = (skill: Skill): void => {
    if (expandedId === skill.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(skill.id);
    if (bodies[skill.id] !== undefined) return;
    void (async () => {
      try {
        const { body } = await window.prospero.learning.readSkillBody(skill.id);
        setBodies((b) => ({ ...b, [skill.id]: body }));
      } catch {
        setBodies((b) => ({ ...b, [skill.id]: t("agent.learning.skills.bodyError") }));
      }
    })();
  };

  if (skills.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-muted">
        {t("agent.learning.skills.empty")}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-surface-border">
      {skills.map((skill) => (
        <li key={skill.id}>
          <button
            type="button"
            onClick={() => toggle(skill)}
            className="w-full text-left px-6 py-3 hover:bg-surface-soft"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-ink">{skill.name}</span>
              {skill.agentId === null && (
                <span className="text-[10px] px-1.5 py-0.5 bg-surface-soft rounded text-ink-muted">
                  🏢 {t("agent.learning.skills.shared")}
                </span>
              )}
              <span className="flex-1" />
              <span
                className="text-[10px] text-ink-soft"
                title={t("agent.learning.skills.usesTitle")}
              >
                ↺ {skill.useCount}
              </span>
              <span
                className="text-[10px] text-ink-soft"
                title={t("agent.learning.skills.trustTitle")}
              >
                {Math.round(skill.trust * 100)}%
              </span>
            </div>
            <p className="text-xs text-ink-muted mt-0.5">{skill.description}</p>
          </button>
          {expandedId === skill.id && (
            <pre className="px-6 pb-3 text-xs text-ink-muted whitespace-pre-wrap font-mono">
              {bodies[skill.id] ?? "…"}
            </pre>
          )}
        </li>
      ))}
    </ul>
  );
};

// --- Memory ---------------------------------------------------------------

const MemoryView: FC<{ memories: Memory[] }> = ({ memories }) => {
  const { t } = useTranslation();

  if (memories.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-muted">
        {t("agent.learning.memory.empty")}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-surface-border">
      {memories.map((m) => (
        <li key={m.id} className="px-6 py-3">
          <span className="text-[10px] px-1.5 py-0.5 bg-surface-soft rounded text-ink-muted">
            {t(`agent.learning.memory.kind.${m.kind}`)}
          </span>
          <p className="text-sm text-ink mt-1">{m.body}</p>
        </li>
      ))}
    </ul>
  );
};

// --- History --------------------------------------------------------------

const HistoryView: FC<{ agentId: string }> = ({ agentId }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SessionSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const runSearch = (): void => {
    const q = query.trim();
    if (q === "") return;
    setSearching(true);
    void (async () => {
      try {
        const hits = await window.prospero.learning.searchSessions(agentId, q);
        setResults(hits);
      } finally {
        setSearching(false);
      }
    })();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-2 px-6 py-3 border-b border-surface-border">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch();
          }}
          placeholder={t("agent.learning.history.placeholder")}
          className="flex-1 text-sm px-2.5 py-1.5 bg-surface-soft border border-surface-border rounded"
        />
        <button
          type="button"
          onClick={runSearch}
          className="text-xs px-3 py-1.5 bg-brand text-brand-fg rounded"
        >
          {t("agent.learning.history.search")}
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {searching && (
          <div className="flex h-full items-center justify-center text-sm text-ink-muted">
            {t("agent.learning.history.searching")}
          </div>
        )}
        {!searching && results === null && (
          <div className="flex h-full items-center justify-center text-sm text-ink-muted">
            {t("agent.learning.history.prompt")}
          </div>
        )}
        {!searching && results !== null && results.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-ink-muted">
            {t("agent.learning.history.empty")}
          </div>
        )}
        {!searching && results !== null && results.length > 0 && (
          <ul className="divide-y divide-surface-border">
            {results.map((hit) => (
              <li key={hit.messageId} className="px-6 py-3">
                <div className="flex items-center gap-2 text-[10px] text-ink-soft">
                  <span className="font-semibold">{hit.senderKind}</span>
                  <span>{new Date(hit.createdAt).toLocaleString()}</span>
                </div>
                <p className="text-sm text-ink mt-0.5">{hit.content}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

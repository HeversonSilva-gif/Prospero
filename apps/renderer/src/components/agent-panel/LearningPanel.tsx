import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Skill, Memory, SessionSearchHit, SkillCandidate } from "@prospero/shared";
import { TabBar, EmptyState, LoadingState } from "../ui/index.js";

interface Props {
  agentId: string;
  skills: Skill[];
  memories: Memory[];
}

type SubTab = "skills" | "memory" | "history" | "candidates";

const SUB_TABS: SubTab[] = ["skills", "memory", "history", "candidates"];

export const LearningPanel: FC<Props> = ({ agentId, skills, memories }) => {
  const { t } = useTranslation();
  const [sub, setSub] = useState<SubTab>("skills");

  return (
    <>
      <TabBar
        variant="underline"
        tabs={SUB_TABS.map((s) => ({ id: s, label: t(`agent.learning.subtabs.${s}`) }))}
        active={sub}
        onSelect={(id: string) => setSub(id as SubTab)}
      />
      <div className="p-6">
        {sub === "skills" && <SkillsView skills={skills} />}
        {sub === "memory" && <MemoryView memories={memories} />}
        {sub === "history" && <HistoryView agentId={agentId} />}
        {sub === "candidates" && <CandidatesView agentId={agentId} />}
      </div>
    </>
  );
};

// --- Skills ---------------------------------------------------------------

const SkillsView: FC<{ skills: Skill[] }> = ({ skills }) => {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bodies, setBodies] = useState<Record<string, string>>({});
  // M11 PR-F1: local trust overrides so a thumb click updates the row at once.
  const [skillTrust, setSkillTrust] = useState<Record<string, number>>({});

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

  const rateSkill = (skillId: string, direction: "up" | "down"): void => {
    void window.prospero.learning.rateSkill(skillId, direction).then((s) => {
      setSkillTrust((prev) => ({ ...prev, [skillId]: s.trust }));
    });
  };

  if (skills.length === 0) {
    return <EmptyState message={t("agent.learning.skills.empty")} />;
  }

  return (
    <ul className="divide-y divide-surface-border">
      {skills.map((skill) => (
        <li key={skill.id}>
          {/* A div, not a button — the row holds the 👍/👎 buttons, and a
              button cannot nest interactive children (invalid HTML). */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => toggle(skill)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle(skill);
              }
            }}
            className="w-full cursor-pointer text-left py-3 hover:bg-surface-soft"
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
                {Math.round((skillTrust[skill.id] ?? skill.trust) * 100)}%
              </span>
              <button
                type="button"
                title={t("agent.learning.skills.rateUp")}
                aria-label={t("agent.learning.skills.rateUp")}
                onClick={(e) => {
                  e.stopPropagation();
                  rateSkill(skill.id, "up");
                }}
                className="text-[10px] text-ink-soft hover:text-semantic-success"
              >
                👍
              </button>
              <button
                type="button"
                title={t("agent.learning.skills.rateDown")}
                aria-label={t("agent.learning.skills.rateDown")}
                onClick={(e) => {
                  e.stopPropagation();
                  rateSkill(skill.id, "down");
                }}
                className="text-[10px] text-ink-soft hover:text-semantic-danger"
              >
                👎
              </button>
            </div>
            <p className="text-xs text-ink-muted mt-0.5">{skill.description}</p>
          </div>
          {expandedId === skill.id && (
            <pre className="pb-3 text-xs text-ink-muted whitespace-pre-wrap font-mono">
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
  // M11 PR-F1: local trust overrides so a thumb click updates the row at once.
  const [memoryTrust, setMemoryTrust] = useState<Record<string, number>>({});

  const rateMemory = (memoryId: string, direction: "up" | "down"): void => {
    void window.prospero.learning.rateMemory(memoryId, direction).then((m) => {
      setMemoryTrust((prev) => ({ ...prev, [memoryId]: m.trust }));
    });
  };

  if (memories.length === 0) {
    return <EmptyState message={t("agent.learning.memory.empty")} />;
  }

  return (
    <ul className="divide-y divide-surface-border">
      {memories.map((m) => (
        <li key={m.id} className="py-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-1.5 py-0.5 bg-surface-soft rounded text-ink-muted">
              {t(`agent.learning.memory.kind.${m.kind}`)}
            </span>
            <span className="flex-1" />
            {memoryTrust[m.id] !== undefined && (
              <span
                className="text-[10px] text-ink-soft"
                title={t("agent.learning.skills.trustTitle")}
              >
                {Math.round((memoryTrust[m.id] ?? m.trust) * 100)}%
              </span>
            )}
            <button
              type="button"
              title={t("agent.learning.skills.rateUp")}
              aria-label={t("agent.learning.skills.rateUp")}
              onClick={() => rateMemory(m.id, "up")}
              className="text-[10px] text-ink-soft hover:text-semantic-success"
            >
              👍
            </button>
            <button
              type="button"
              title={t("agent.learning.skills.rateDown")}
              aria-label={t("agent.learning.skills.rateDown")}
              onClick={() => rateMemory(m.id, "down")}
              className="text-[10px] text-ink-soft hover:text-semantic-danger"
            >
              👎
            </button>
          </div>
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
    <div>
      <div className="flex gap-2 mb-4">
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
      {searching && <LoadingState label={t("agent.learning.history.searching")} />}
      {!searching && results === null && (
        <EmptyState message={t("agent.learning.history.prompt")} />
      )}
      {!searching && results !== null && results.length === 0 && (
        <EmptyState message={t("agent.learning.history.empty")} />
      )}
      {!searching && results !== null && results.length > 0 && (
        <ul className="divide-y divide-surface-border">
          {results.map((hit) => (
            <li key={hit.messageId} className="py-3">
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
  );
};

// --- Candidates -----------------------------------------------------------

const CandidatesView: FC<{ agentId: string }> = ({ agentId }) => {
  const { t } = useTranslation();
  const [candidates, setCandidates] = useState<SkillCandidate[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftBody, setDraftBody] = useState("");

  useEffect(() => {
    void (async () => {
      const list = await window.prospero.learning.listCandidates(agentId);
      setCandidates(list);
    })();
  }, [agentId]);

  const remove = (id: string): void => {
    setCandidates((cur) => (cur ?? []).filter((c) => c.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const accept = (
    c: SkillCandidate,
    overrides?: { name: string; description: string; body: string },
  ): void => {
    setBusyId(c.id);
    setErrorId(null);
    void (async () => {
      try {
        await window.prospero.learning.acceptCandidate({
          candidateId: c.id,
          ...(overrides ?? {}),
        });
        remove(c.id);
      } catch {
        setErrorId(c.id);
      } finally {
        setBusyId(null);
      }
    })();
  };

  const reject = (c: SkillCandidate): void => {
    setBusyId(c.id);
    setErrorId(null);
    void (async () => {
      try {
        await window.prospero.learning.rejectCandidate({ candidateId: c.id });
        remove(c.id);
      } catch {
        setErrorId(c.id);
      } finally {
        setBusyId(null);
      }
    })();
  };

  const startEdit = (c: SkillCandidate): void => {
    setEditingId(c.id);
    setErrorId(null);
    setDraftName(c.proposedName);
    setDraftDesc(c.proposedDescription);
    setDraftBody(c.proposedBody);
  };

  if (candidates === null) {
    return <LoadingState />;
  }
  if (candidates.length === 0) {
    return <EmptyState message={t("agent.learning.candidates.empty")} />;
  }

  return (
    <ul className="divide-y divide-surface-border">
      {candidates.map((c) => (
        <li key={c.id} className="py-3">
          {editingId === c.id ? (
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder={t("agent.learning.candidates.nameLabel")}
                className="text-sm px-2.5 py-1.5 bg-surface-soft border border-surface-border rounded"
              />
              <input
                type="text"
                value={draftDesc}
                onChange={(e) => setDraftDesc(e.target.value)}
                placeholder={t("agent.learning.candidates.descriptionLabel")}
                className="text-sm px-2.5 py-1.5 bg-surface-soft border border-surface-border rounded"
              />
              <textarea
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                placeholder={t("agent.learning.candidates.bodyLabel")}
                rows={6}
                className="text-xs font-mono px-2.5 py-1.5 bg-surface-soft border border-surface-border rounded"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busyId === c.id}
                  onClick={() =>
                    accept(c, { name: draftName, description: draftDesc, body: draftBody })
                  }
                  className="text-xs px-3 py-1.5 bg-brand text-brand-fg rounded disabled:opacity-50"
                >
                  {t("agent.learning.candidates.save")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setErrorId(null);
                  }}
                  className="text-xs px-3 py-1.5 bg-surface-soft text-ink-muted rounded"
                >
                  {t("agent.learning.candidates.cancel")}
                </button>
              </div>
              {errorId === c.id && (
                <p className="text-xs text-semantic-danger">
                  {t("agent.learning.candidates.error")}
                </p>
              )}
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-ink">{c.proposedName}</span>
                <span className="text-[10px] px-1.5 py-0.5 bg-surface-soft rounded text-ink-muted">
                  {t(`agent.learning.candidates.trigger.${c.trigger}`)}
                </span>
              </div>
              <p className="text-xs text-ink-muted mt-0.5">{c.proposedDescription}</p>
              <pre className="mt-1.5 text-xs text-ink-muted whitespace-pre-wrap font-mono">
                {c.proposedBody}
              </pre>
              {errorId === c.id && (
                <p className="text-xs text-semantic-danger mt-1">
                  {t("agent.learning.candidates.error")}
                </p>
              )}
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  disabled={busyId === c.id}
                  onClick={() => accept(c)}
                  className="text-xs px-3 py-1.5 bg-brand text-brand-fg rounded disabled:opacity-50"
                >
                  {t("agent.learning.candidates.accept")}
                </button>
                <button
                  type="button"
                  disabled={busyId === c.id}
                  onClick={() => startEdit(c)}
                  className="text-xs px-3 py-1.5 bg-surface-soft text-ink-muted rounded hover:bg-surface-border disabled:opacity-50"
                >
                  {t("agent.learning.candidates.edit")}
                </button>
                <button
                  type="button"
                  disabled={busyId === c.id}
                  onClick={() => reject(c)}
                  className="text-xs px-3 py-1.5 bg-surface-soft text-ink-muted rounded hover:bg-surface-border disabled:opacity-50"
                >
                  {t("agent.learning.candidates.reject")}
                </button>
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
};

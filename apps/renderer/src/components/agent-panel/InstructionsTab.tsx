import { type FC, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type Props = { agentId: string };

type FileEntry = { filename: string; isEntry: boolean };

export const InstructionsTab: FC<Props> = ({ agentId }) => {
  const { t } = useTranslation();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<string>("charter.md");
  const [body, setBody] = useState<string>("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const res = await window.prospero.instructions.list(agentId);
    setFiles(res.files);
  }, [agentId]);

  // Load the file list when the agent changes.
  useEffect(() => {
    setSelected("charter.md");
    void refresh();
  }, [agentId, refresh]);

  // Load the selected file's body.
  useEffect(() => {
    setSavedAt(null);
    setError(null);
    void (async () => {
      const res = await window.prospero.instructions.read(agentId, selected);
      setBody(res.body);
    })();
  }, [agentId, selected]);

  // Debounced save (500ms after the last keystroke).
  useEffect(() => {
    const handle = setTimeout(() => {
      void (async () => {
        try {
          await window.prospero.instructions.write(agentId, selected, body);
          setSavedAt(Date.now());
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })();
    }, 500);
    return () => clearTimeout(handle);
  }, [body, agentId, selected]);

  const onAdd = async (): Promise<void> => {
    const raw = window.prompt(t("agent.instructions.addPrompt"));
    if (raw === null || raw.trim() === "") return;
    let name = raw.trim().toLowerCase();
    if (!name.endsWith(".md")) name += ".md";
    setError(null);
    try {
      await window.prospero.instructions.add(agentId, name);
      await refresh();
      setSelected(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onDelete = async (filename: string): Promise<void> => {
    if (!window.confirm(t("agent.instructions.confirmDelete", { filename }))) return;
    setError(null);
    try {
      await window.prospero.instructions.delete(agentId, filename);
      if (selected === filename) setSelected("charter.md");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex h-full min-h-0 p-6 gap-0">
      {/* ── Left pane: file tree ──────────────────────────────────── */}
      <div className="flex flex-col w-[220px] shrink-0 min-h-0 border-r border-surface-border pr-4 mr-4">
        {/* Pane header */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] uppercase tracking-widest font-semibold text-ink-soft select-none">
            {t("agent.instructions.title")}
          </span>
          <button
            type="button"
            onClick={() => void onAdd()}
            className="text-[10px] px-2 py-0.5 rounded bg-surface-soft text-ink-muted hover:text-brand transition-colors"
          >
            {t("agent.instructions.add")}
          </button>
        </div>

        {/* File list */}
        <ul className="flex-1 min-h-0 overflow-y-auto space-y-0.5">
          {files.map((f) => (
            <li key={f.filename} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSelected(f.filename)}
                className={`flex-1 text-left px-2 py-1.5 rounded font-mono text-xs truncate transition-colors ${
                  selected === f.filename
                    ? "bg-brand-bg text-brand-dark font-medium"
                    : "text-ink-muted hover:bg-surface-soft hover:text-ink-soft"
                }`}
              >
                <span className="truncate">{f.filename}</span>
                {f.isEntry && (
                  <span className="ml-1.5 text-[9px] uppercase tracking-wider text-ink-soft opacity-70">
                    {t("agent.instructions.entryBadge")}
                  </span>
                )}
              </button>
              {!f.isEntry && (
                <button
                  type="button"
                  onClick={() => void onDelete(f.filename)}
                  className="opacity-0 group-hover:opacity-100 text-[10px] text-ink-soft hover:text-rose-600 px-1 transition-all"
                  aria-label={t("agent.instructions.delete")}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* ── Right pane: editor ────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-h-0 min-w-0">
        {/* Filename label */}
        <div className="mb-2 flex items-center gap-2">
          <span className="font-mono text-[11px] text-ink-muted select-none">{selected}</span>
          {savedAt !== null && (
            <span className="text-[10px] text-semantic-success">
              {t("agent.instructions.saved")}
            </span>
          )}
          {error !== null && (
            <span className="text-[10px] text-semantic-danger truncate">{error}</span>
          )}
        </div>

        {/* Textarea */}
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setSavedAt(null);
          }}
          className="flex-1 min-h-0 w-full px-3 py-2.5 border border-surface-border rounded bg-surface text-xs font-mono leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-brand/30"
        />

        {/* Footer note */}
        <p className="mt-2 text-[10px] text-ink-soft">{t("agent.instructions.applyNote")}</p>
      </div>
    </div>
  );
};

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
    <div className="p-4 space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold">
          {t("agent.instructions.title")}
        </h3>
        <button
          type="button"
          onClick={() => void onAdd()}
          className="text-[10px] px-2 py-0.5 rounded bg-surface-soft text-ink-muted hover:text-brand"
        >
          {t("agent.instructions.add")}
        </button>
      </div>

      <ul className="space-y-0.5">
        {files.map((f) => (
          <li key={f.filename} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSelected(f.filename)}
              className={`flex-1 text-left px-2 py-1 rounded font-mono ${
                selected === f.filename
                  ? "bg-brand-bg text-brand-dark"
                  : "text-ink-muted hover:bg-surface-soft"
              }`}
            >
              {f.filename}
              {f.isEntry && (
                <span className="ml-1 text-[9px] uppercase text-ink-soft">
                  {t("agent.instructions.entryBadge")}
                </span>
              )}
            </button>
            {!f.isEntry && (
              <button
                type="button"
                onClick={() => void onDelete(f.filename)}
                className="text-[10px] text-ink-soft hover:text-rose-600 px-1"
                aria-label={t("agent.instructions.delete")}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>

      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setSavedAt(null);
        }}
        rows={16}
        className="w-full px-2 py-1.5 border border-surface-border rounded bg-surface text-xs font-mono leading-relaxed resize-y"
      />
      {savedAt !== null && (
        <p className="text-[10px] text-semantic-success">{t("agent.instructions.saved")}</p>
      )}
      {error !== null && <p className="text-[10px] text-semantic-danger">{error}</p>}
      <p className="text-[10px] text-ink-soft">{t("agent.instructions.applyNote")}</p>
    </div>
  );
};

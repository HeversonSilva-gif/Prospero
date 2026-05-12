import { useState, type FC, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { IssuePriority } from "@dashboard-agent/shared";
import { useIssuesStore } from "../../stores/issues.js";
import { useProjectsStore } from "../../stores/projects.js";
import { useAgentsStore } from "../../stores/agents.js";

type Props = {
  companyId: string;
  parentId?: string;
  initialAssigneeId?: string | null;
  onClose: () => void;
};

const PRIORITIES: IssuePriority[] = ["low", "medium", "high", "urgent"];

export const IssueFormModal: FC<Props> = ({ companyId, parentId, initialAssigneeId, onClose }) => {
  const { t } = useTranslation();
  const projects = useProjectsStore((s) => s.projects);
  const agents = useAgentsStore((s) => s.agents);
  const create = useIssuesStore((s) => s.create);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string>(projects[0]?.id ?? "");
  const [assigneeId, setAssigneeId] = useState<string>(initialAssigneeId ?? "");
  const [priority, setPriority] = useState<IssuePriority>("medium");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (title.trim() === "") return;
    setBusy(true);
    try {
      const input: {
        companyId: string;
        projectId: string | null;
        title: string;
        description: string | null;
        assigneeId: string | null;
        priority: IssuePriority;
        parentId?: string | null;
      } = {
        companyId,
        projectId: projectId === "" ? null : projectId,
        title: title.trim(),
        description: description === "" ? null : description,
        assigneeId: assigneeId === "" ? null : assigneeId,
        priority,
      };
      if (parentId !== undefined) input.parentId = parentId;
      await create(input);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <form onSubmit={submit} className="bg-surface-card rounded p-5 w-full max-w-md shadow-xl">
        <label className="block text-xs uppercase text-ink-soft mb-1">
          {t("issues.form.title")}
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          minLength={1}
          className="w-full mb-3 px-2 py-1 border border-surface-border rounded text-sm"
        />
        <label className="block text-xs uppercase text-ink-soft mb-1">
          {t("issues.form.description")}
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full mb-3 px-2 py-1 border border-surface-border rounded text-sm"
        />
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs uppercase text-ink-soft mb-1">
              {t("issues.form.project")}
            </label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full px-2 py-1 border border-surface-border rounded text-sm"
            >
              <option value="">—</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs uppercase text-ink-soft mb-1">
              {t("issues.form.assignee")}
            </label>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="w-full px-2 py-1 border border-surface-border rounded text-sm"
            >
              <option value="">—</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="block text-xs uppercase text-ink-soft mb-1">
          {t("issues.form.priority")}
        </label>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as IssuePriority)}
          className="w-full mb-4 px-2 py-1 border border-surface-border rounded text-sm"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded"
          >
            {t("issues.form.cancel")}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="text-xs px-3 py-1 bg-brand text-brand-fg rounded font-semibold disabled:opacity-50"
          >
            {t("issues.form.create")}
          </button>
        </div>
      </form>
    </div>
  );
};

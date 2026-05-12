import {
  useEffect,
  useMemo,
  useState,
  type FC,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAgentsStore } from "../stores/agents.js";
import { useIssuesStore } from "../stores/issues.js";
import { layoutTree, NODE_DIMENSIONS } from "../components/org/layoutTree.js";
import { OrgNode } from "../components/org/OrgNode.js";
import { ReassignConfirmModal } from "../components/org/ReassignConfirmModal.js";

export const Org: FC = () => {
  const { t } = useTranslation();
  const agents = useAgentsStore((s) => s.agents);
  const setReportsTo = useAgentsStore((s) => s.setReportsTo);
  const issues = useIssuesStore((s) => s.issues);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null);
  const [pendingReassign, setPendingReassign] = useState<{
    childId: string;
    parentId: string;
  } | null>(null);
  const [reassignError, setReassignError] = useState<string | null>(null);

  const layout = useMemo(() => layoutTree(agents), [agents]);
  const selected = useMemo(
    () => (selectedId !== null ? (agents.find((a) => a.id === selectedId) ?? null) : null),
    [agents, selectedId],
  );
  const selectedOpenIssues = useMemo(() => {
    if (selected === null) return 0;
    return issues.filter((i) => i.assigneeId === selected.id && i.status !== "done").length;
  }, [issues, selected]);

  const positions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of layout.nodes) m.set(n.id, { x: n.x, y: n.y });
    return m;
  }, [layout]);

  const edges = useMemo(() => {
    return layout.nodes
      .filter((n) => n.reportsTo !== null && positions.has(n.reportsTo))
      .map((n) => ({
        from: positions.get(n.reportsTo!)!,
        to: { x: n.x, y: n.y },
        childId: n.id,
      }));
  }, [layout, positions]);

  // ESC closes drawer and dismisses error toast.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setSelectedId(null);
        setReassignError(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Auto-dismiss the cycle error toast after 4s.
  useEffect(() => {
    if (reassignError === null) return;
    const h = setTimeout(() => setReassignError(null), 4000);
    return () => clearTimeout(h);
  }, [reassignError]);

  if (agents.length === 0) {
    return <div className="p-8 text-ink-muted text-sm">{t("org.empty")}</div>;
  }

  const svgWidth = layout.width + 48;
  const svgHeight = layout.height + 48;

  const onNodePointerDown = (id: string, e: ReactPointerEvent<SVGGElement>): void => {
    setDraggingId(id);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onSvgPointerMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (draggingId === null) return;
    const svgEl = e.currentTarget;
    const pt = svgEl.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svgEl.getScreenCTM();
    if (ctm === null) return;
    const local = pt.matrixTransform(ctm.inverse());
    // Outer <g> is translated by (24, 24); adjust for hit-test in local coords.
    const lx = local.x - 24;
    const ly = local.y - 24;
    let foundId: string | null = null;
    for (const n of layout.nodes) {
      if (n.id === draggingId) continue;
      if (
        lx >= n.x &&
        lx <= n.x + NODE_DIMENSIONS.width &&
        ly >= n.y &&
        ly <= n.y + NODE_DIMENSIONS.height
      ) {
        foundId = n.id;
        break;
      }
    }
    setHoverTargetId(foundId);
  };

  const onSvgPointerUp = (): void => {
    if (draggingId !== null && hoverTargetId !== null) {
      setPendingReassign({ childId: draggingId, parentId: hoverTargetId });
    }
    setDraggingId(null);
    setHoverTargetId(null);
  };

  const childName =
    pendingReassign !== null
      ? (agents.find((a) => a.id === pendingReassign.childId)?.name ?? "?")
      : "";
  const parentName =
    pendingReassign !== null
      ? (agents.find((a) => a.id === pendingReassign.parentId)?.name ?? "?")
      : "";

  return (
    <div className="h-full flex">
      <div className="flex-1 overflow-auto bg-surface-soft p-6">
        <svg
          width={svgWidth}
          height={svgHeight}
          className="bg-surface-card rounded shadow-sm select-none"
          onPointerMove={onSvgPointerMove}
          onPointerUp={onSvgPointerUp}
        >
          <defs>
            <linearGradient id="avatar-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#5a8fff" />
              <stop offset="100%" stopColor="#3850b0" />
            </linearGradient>
          </defs>
          <g transform="translate(24, 24)">
            {edges.map((e, i) => {
              const startX = e.from.x + NODE_DIMENSIONS.width / 2;
              const startY = e.from.y + NODE_DIMENSIONS.height;
              const endX = e.to.x + NODE_DIMENSIONS.width / 2;
              const endY = e.to.y;
              const midY = (startY + endY) / 2;
              return (
                <path
                  key={`edge-${e.childId}-${String(i)}`}
                  d={`M${String(startX)},${String(startY)} L${String(startX)},${String(midY)} L${String(endX)},${String(midY)} L${String(endX)},${String(endY)}`}
                  fill="none"
                  stroke="#d0d4dc"
                  strokeWidth={1.5}
                />
              );
            })}
            {layout.nodes.map((n) => (
              <OrgNode
                key={n.id}
                node={n}
                selected={n.id === selectedId}
                dragging={n.id === draggingId}
                dropTarget={n.id === hoverTargetId}
                onPointerDown={(e) => onNodePointerDown(n.id, e)}
                onClick={() => {
                  if (draggingId === null) setSelectedId(n.id);
                }}
              />
            ))}
          </g>
        </svg>
      </div>
      {selected !== null && (
        <aside className="w-80 border-l border-surface-border bg-surface-card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-md bg-gradient-to-br from-brand to-brand-dark text-white flex items-center justify-center text-base font-bold">
              {selected.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1">
              <h2 className="text-base font-bold text-brand-dark">{selected.name}</h2>
              <p className="text-[11px] text-ink-muted">
                {selected.role !== "" ? selected.role : "—"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="text-ink-muted hover:text-ink"
            >
              ×
            </button>
          </div>
          <dl className="space-y-3 text-xs">
            <div>
              <dt className="text-[10px] uppercase text-ink-soft font-semibold">
                {t("org.drawer.model")}
              </dt>
              <dd className="font-mono text-[11px]">{selected.model}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase text-ink-soft font-semibold">
                {t("org.drawer.status")}
              </dt>
              <dd className="capitalize">{selected.status}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase text-ink-soft font-semibold">
                {t("org.drawer.openIssues")}
              </dt>
              <dd>{selectedOpenIssues}</dd>
            </div>
          </dl>
          <Link
            to={`/agents/${selected.id}`}
            className="mt-5 block text-center text-xs px-3 py-2 bg-brand text-brand-fg rounded font-semibold"
          >
            {t("org.drawer.openAgent")}
          </Link>
        </aside>
      )}
      {pendingReassign !== null && (
        <ReassignConfirmModal
          childName={childName}
          newParentName={parentName}
          onCancel={() => setPendingReassign(null)}
          onConfirm={async () => {
            try {
              await setReportsTo(pendingReassign.childId, pendingReassign.parentId);
            } catch {
              setReassignError(t("org.reassign.cycleError"));
            }
            setPendingReassign(null);
          }}
        />
      )}
      {reassignError !== null && (
        <div className="fixed bottom-6 right-6 bg-semantic-danger text-white px-4 py-2 rounded shadow-lg text-xs z-50">
          {reassignError}
        </div>
      )}
    </div>
  );
};

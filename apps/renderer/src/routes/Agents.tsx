import {
  useEffect,
  useMemo,
  useState,
  type FC,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAgentsStore } from "../stores/agents.js";
import { RoleTemplateGalleryModal } from "../components/RoleTemplateGalleryModal.js";
import { layoutTree, NODE_DIMENSIONS } from "../components/org/layoutTree.js";
import { OrgNode } from "../components/org/OrgNode.js";
import { ReassignConfirmModal } from "../components/org/ReassignConfirmModal.js";

// M16 PR-C1 — "Minha equipe" — substitui o grid de agentes pelo organograma.
// Migra o conteúdo de Org.tsx menos o side drawer (clicar num nó navega pra
// /agents/:id). Mantém drag-to-reparent (M9 power feature) + ReassignConfirmModal.

export const Agents: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const agents = useAgentsStore((s) => s.agents);
  const setReportsTo = useAgentsStore((s) => s.setReportsTo);
  const [showGallery, setShowGallery] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null);
  const [pendingReassign, setPendingReassign] = useState<{
    childId: string;
    parentId: string;
  } | null>(null);
  const [reassignError, setReassignError] = useState<string | null>(null);

  const layout = useMemo(() => layoutTree(agents), [agents]);

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

  // Auto-dismiss the cycle error toast after 4s.
  useEffect(() => {
    if (reassignError === null) return;
    const h = setTimeout(() => setReassignError(null), 4000);
    return () => clearTimeout(h);
  }, [reassignError]);

  const live = agents.filter((a) => a.status !== "terminated");
  const isEmpty = live.length === 0;

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

  const svgWidth = layout.width + 48;
  const svgHeight = layout.height + 48;

  return (
    <div className="h-full flex flex-col">
      <header className="px-8 py-6 border-b border-surface-border bg-surface">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink">{t("equipe.title")}</h1>
            <p className="mt-1 text-sm text-ink-soft">{t("equipe.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowGallery(true)}
            className="px-3 py-1.5 text-sm font-semibold bg-brand text-brand-fg rounded hover:opacity-90 whitespace-nowrap"
          >
            {t("equipe.contratar")}
          </button>
        </div>
      </header>

      {isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 bg-surface-soft p-8">
          <p className="text-base font-semibold text-ink">{t("equipe.empty.title")}</p>
          <p className="text-sm text-ink-muted">{t("equipe.empty.description")}</p>
        </div>
      ) : (
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
                  selected={false}
                  dragging={n.id === draggingId}
                  dropTarget={n.id === hoverTargetId}
                  onPointerDown={(e) => onNodePointerDown(n.id, e)}
                  onClick={() => {
                    if (draggingId === null) navigate(`/agents/${n.id}`);
                  }}
                />
              ))}
            </g>
          </svg>
        </div>
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

      {showGallery && <RoleTemplateGalleryModal onClose={() => setShowGallery(false)} />}
    </div>
  );
};

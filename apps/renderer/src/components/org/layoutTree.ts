import type { Agent } from "@prospero/shared";

export type PositionedNode = {
  id: string;
  name: string;
  role: string;
  status: string;
  templateId: string | null;
  reportsTo: string | null;
  depth: number;
  x: number;
  y: number;
};

export type LayoutResult = {
  nodes: PositionedNode[];
  width: number;
  height: number;
};

const NODE_WIDTH = 180;
const NODE_HEIGHT = 80;
const H_GAP = 28;
const V_GAP = 56;

type LayoutNode = {
  agent: Agent;
  children: LayoutNode[];
  subtreeWidth: number;
};

// Each subtree's footprint is the sum of children footprints (or its own
// node width when leaf). Two-pass: first measure, then place at x = leftEdge
// + subtreeWidth/2 - NODE_WIDTH/2.
export const layoutTree = (agents: Agent[]): LayoutResult => {
  if (agents.length === 0) return { nodes: [], width: 0, height: 0 };

  const byId = new Map<string, Agent>();
  for (const a of agents) byId.set(a.id, a);

  const childrenOf = new Map<string, Agent[]>();
  const roots: Agent[] = [];
  for (const a of agents) {
    const parentId = a.reportsTo;
    if (parentId === null || !byId.has(parentId)) {
      roots.push(a);
    } else {
      const arr = childrenOf.get(parentId) ?? [];
      arr.push(a);
      childrenOf.set(parentId, arr);
    }
  }

  const build = (a: Agent): LayoutNode => {
    const kids = (childrenOf.get(a.id) ?? []).map(build);
    const subtreeWidth =
      kids.length === 0
        ? NODE_WIDTH
        : kids.reduce((acc, k) => acc + k.subtreeWidth, 0) + H_GAP * (kids.length - 1);
    return { agent: a, children: kids, subtreeWidth };
  };

  const layoutRoots = roots.map(build);
  const totalWidth =
    layoutRoots.reduce((acc, r) => acc + r.subtreeWidth, 0) +
    H_GAP * Math.max(0, layoutRoots.length - 1);

  const out: PositionedNode[] = [];
  let cursorX = 0;

  const place = (node: LayoutNode, depth: number, leftX: number): void => {
    const myX = leftX + node.subtreeWidth / 2 - NODE_WIDTH / 2;
    out.push({
      id: node.agent.id,
      name: node.agent.name,
      role: node.agent.role,
      status: node.agent.status,
      templateId: node.agent.templateId,
      reportsTo: node.agent.reportsTo,
      depth,
      x: myX,
      y: depth * (NODE_HEIGHT + V_GAP),
    });
    let childCursor = leftX;
    for (const k of node.children) {
      place(k, depth + 1, childCursor);
      childCursor += k.subtreeWidth + H_GAP;
    }
  };

  for (const r of layoutRoots) {
    place(r, 0, cursorX);
    cursorX += r.subtreeWidth + H_GAP;
  }

  const maxDepth = Math.max(0, ...out.map((n) => n.depth));
  const height = (maxDepth + 1) * (NODE_HEIGHT + V_GAP);
  return { nodes: out, width: totalWidth, height };
};

export const NODE_DIMENSIONS = {
  width: NODE_WIDTH,
  height: NODE_HEIGHT,
  hGap: H_GAP,
  vGap: V_GAP,
};

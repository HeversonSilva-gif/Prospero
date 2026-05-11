import { type FC, type PointerEvent as ReactPointerEvent } from "react";
import type { PositionedNode } from "./layoutTree.js";

type Props = {
  node: PositionedNode;
  selected: boolean;
  dragging: boolean;
  dropTarget: boolean;
  onPointerDown: (e: ReactPointerEvent<SVGGElement>) => void;
  onClick: () => void;
};

const STATUS_FILL: Record<string, string> = {
  idle: "#a0a4ab",
  thinking: "#5a8fff",
  working: "#3fbf5f",
  waiting: "#f3a83c",
  error: "#e2434a",
};

export const OrgNode: FC<Props> = ({
  node,
  selected,
  dragging,
  dropTarget,
  onPointerDown,
  onClick,
}) => {
  const fill = STATUS_FILL[node.status] ?? "#a0a4ab";
  const strokeColor = dropTarget ? "#3fbf5f" : selected ? "#5a8fff" : "#d0d4dc";
  const strokeWidth = dropTarget || selected ? 2 : 1;
  return (
    <g
      transform={`translate(${String(node.x)}, ${String(node.y)})`}
      style={{ cursor: dragging ? "grabbing" : "grab" }}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <rect
        width={180}
        height={80}
        rx={8}
        fill={selected ? "#eef2ff" : dropTarget ? "#e6f7ec" : "white"}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        style={{ opacity: dragging ? 0.4 : 1 }}
      />
      <circle cx={20} cy={20} r={14} fill="url(#avatar-grad)" />
      <text
        x={20}
        y={25}
        textAnchor="middle"
        fontSize="11"
        fontWeight="700"
        fill="white"
        pointerEvents="none"
      >
        {node.name.slice(0, 2).toUpperCase()}
      </text>
      <text x={44} y={22} fontSize="13" fontWeight="700" fill="#1f2937" pointerEvents="none">
        {node.name}
      </text>
      <text x={44} y={38} fontSize="10" fill="#6b7280" pointerEvents="none">
        {node.role !== "" ? node.role : "—"}
      </text>
      <circle cx={20} cy={62} r={4} fill={fill} pointerEvents="none" />
      <text x={32} y={66} fontSize="10" fill="#6b7280" pointerEvents="none">
        {node.status}
      </text>
    </g>
  );
};

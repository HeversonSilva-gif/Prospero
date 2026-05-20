import type { FC } from "react";

// M16 PR-A1 — line icons inline para a sidebar.
// 24x24 viewBox, stroke currentColor. Estilo Lucide line.
// Sem dependência de icon library — o codebase usa SVG inline.

type IconProps = {
  className?: string;
};

const SIZE = 20;
const COMMON_PROPS = {
  width: SIZE,
  height: SIZE,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const HomeIcon: FC<IconProps> = ({ className }) => (
  <svg {...COMMON_PROPS} className={className}>
    <path d="M3 11 L12 4 L21 11" />
    <path d="M5 10 L5 20 L19 20 L19 10" />
    <path d="M10 20 L10 14 L14 14 L14 20" />
  </svg>
);

export const SparklesIcon: FC<IconProps> = ({ className }) => (
  <svg {...COMMON_PROPS} className={className}>
    <path d="M12 3 L13.5 8.5 L19 10 L13.5 11.5 L12 17 L10.5 11.5 L5 10 L10.5 8.5 Z" />
    <path d="M18 16 L18.7 18.3 L21 19 L18.7 19.7 L18 22 L17.3 19.7 L15 19 L17.3 18.3 Z" />
  </svg>
);

export const FolderIcon: FC<IconProps> = ({ className }) => (
  <svg {...COMMON_PROPS} className={className}>
    <path d="M3 7 L3 19 A1 1 0 0 0 4 20 L20 20 A1 1 0 0 0 21 19 L21 9 A1 1 0 0 0 20 8 L11 8 L9 6 L4 6 A1 1 0 0 0 3 7 Z" />
  </svg>
);

export const UsersIcon: FC<IconProps> = ({ className }) => (
  <svg {...COMMON_PROPS} className={className}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 20 C3 16 5.5 14 9 14 C12.5 14 15 16 15 20" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M17 13.5 C19.5 13.5 21 15 21 17.5" />
  </svg>
);

export const SettingsIcon: FC<IconProps> = ({ className }) => (
  <svg {...COMMON_PROPS} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2 L12 5 M12 19 L12 22 M2 12 L5 12 M19 12 L22 12 M4.93 4.93 L7.05 7.05 M16.95 16.95 L19.07 19.07 M4.93 19.07 L7.05 16.95 M16.95 7.05 L19.07 4.93" />
  </svg>
);

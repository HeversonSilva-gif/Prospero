import type { FC } from "react";

// M16 PR-B1 — line icons inline para Início.
// 24x24 viewBox, stroke currentColor. Estilo Lucide line.

type IconProps = {
  className?: string;
  size?: number;
};

const STROKE_PROPS = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const CheckCircleIcon: FC<IconProps> = ({ className, size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    {...STROKE_PROPS}
    aria-hidden="true"
    className={className}
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5 L10.7 15 L16 9.5" />
  </svg>
);

export const PlayIcon: FC<IconProps> = ({ className, size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    className={className}
  >
    <path d="M8.5 5.5 V18.5 L19 12 Z" />
  </svg>
);

export const CreditCardIcon: FC<IconProps> = ({ className, size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    {...STROKE_PROPS}
    aria-hidden="true"
    className={className}
  >
    <rect x="3" y="6.5" width="18" height="12" rx="2.5" />
    <path d="M3 11 L21 11" />
  </svg>
);

export const AlertTriangleIcon: FC<IconProps> = ({ className, size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    {...STROKE_PROPS}
    aria-hidden="true"
    className={className}
  >
    <path d="M12 4 L21 19.5 H3 Z" />
    <line x1="12" y1="10" x2="12" y2="14" />
    <line x1="12" y1="16.5" x2="12" y2="16.7" />
  </svg>
);

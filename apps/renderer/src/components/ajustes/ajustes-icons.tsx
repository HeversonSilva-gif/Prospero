import type { FC } from "react";

// M16 PR-B2 — line icons para os tiles da grade Ajustes.
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

export const UserIcon: FC<IconProps> = ({ className, size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    {...STROKE_PROPS}
    aria-hidden="true"
    className={className}
  >
    <circle cx="12" cy="9" r="3.4" />
    <path d="M5.5 19.5c0-3.4 2.9-5.5 6.5-5.5s6.5 2.1 6.5 5.5" />
  </svg>
);

export const CreditCardIcon: FC<IconProps> = ({ className, size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    {...STROKE_PROPS}
    aria-hidden="true"
    className={className}
  >
    <rect x="3" y="6.5" width="18" height="12" rx="2.6" />
    <path d="M3 11h18" />
  </svg>
);

export const SlidersIcon: FC<IconProps> = ({ className, size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    {...STROKE_PROPS}
    aria-hidden="true"
    className={className}
  >
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="17" x2="20" y2="17" />
    <circle cx="9" cy="7" r="2.2" />
    <circle cx="15" cy="12" r="2.2" />
    <circle cx="8" cy="17" r="2.2" />
  </svg>
);

export const WrenchIcon: FC<IconProps> = ({ className, size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    {...STROKE_PROPS}
    aria-hidden="true"
    className={className}
  >
    <path d="M14.5 6.5a3.5 3.5 0 0 0 4.5 4.5L21 13l-8 8-2-2 8-8-1.5-1.5z" />
    <path d="M6 14l-3 3 2 2 3-3" />
  </svg>
);

import type { ButtonHTMLAttributes, FC } from "react";

type Variant = "primary" | "ghost";

const VARIANT: Record<Variant, string> = {
  primary: "bg-brand text-brand-fg hover:bg-brand-dark",
  ghost: "text-brand border border-brand-soft hover:bg-brand-bg",
};

export const Button: FC<ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }> = ({
  variant = "primary",
  className,
  ...rest
}) => (
  <button
    className={`text-[13px] font-semibold px-4 py-2.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${VARIANT[variant]} ${className ?? ""}`}
    {...rest}
  />
);

import type { FC } from "react";
import { agentStatusInfo } from "../../lib/status.js";

export const StatusDot: FC<{ status: string; className?: string }> = ({ status, className }) => {
  const info = agentStatusInfo(status);
  return (
    <span
      className={`inline-block w-[7px] h-[7px] rounded-full ${info.dotClass}${className ? ` ${className}` : ""}`}
      style={{ boxShadow: `0 0 0 3px ${info.halo}` }}
      aria-hidden="true"
    />
  );
};

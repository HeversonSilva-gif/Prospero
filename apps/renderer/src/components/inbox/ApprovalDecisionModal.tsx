import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { InboxItem } from "@prospero/shared";
import {
  DecisionModal,
  DecisionHeader,
  HeroSummary,
  DecisionActions,
  type ChipVariant,
} from "../decision/index.js";

type Props = {
  item: InboxItem;
  open: boolean;
  onClose: () => void;
  onDecided: () => void;
};

type ManagerRequestPayload = {
  topic?: string;
  requester?: string;
  toolName?: string;
};

const parsePayload = (payloadJson: string | null): ManagerRequestPayload => {
  if (payloadJson === null) return {};
  try {
    return JSON.parse(payloadJson) as ManagerRequestPayload;
  } catch {
    return {};
  }
};

const chipVariantForItem = (item: InboxItem, payload: ManagerRequestPayload): ChipVariant => {
  if (item.kind === "approval") return "brand";
  // manager_request — topic-based
  const topic = payload.topic ?? "";
  if (topic === "fire") return "bad";
  if (topic === "hire") return "goal";
  if (topic === "budget") return "warn";
  return "brand";
};

export const ApprovalDecisionModal: FC<Props> = ({ item, open, onClose, onDecided }) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");

  const payload = parsePayload(item.payloadJson);

  const isToolCall = item.kind === "approval";
  const chipVariant = chipVariantForItem(item, payload);

  const chipLabel = isToolCall
    ? t("decision.m18.chipToolCall")
    : t("decision.m18.chipManagerRequest");

  const kindLabel = isToolCall
    ? t("decision.m18.kindToolCall")
    : t("decision.m18.kindManagerRequest");

  const kindSub = isToolCall ? (payload.toolName ?? "—") : (payload.topic ?? "—");

  const requesterName = payload.requester ?? (item.actorId !== null ? item.actorId : "—");

  const metaWhen = new Date(item.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const handleApprove = async (): Promise<void> => {
    setBusy(true);
    try {
      if (isToolCall) {
        const p = parsePayload(item.payloadJson) as { toolUseId?: string };
        if (p.toolUseId !== undefined) {
          await window.prospero.permissions.resolve(p.toolUseId, { behavior: "allow" });
        }
      } else {
        if (item.approvalId !== null) {
          await window.prospero.managerRequest.decide(
            item.approvalId,
            "approved",
            comment.trim() || undefined,
          );
        }
      }
      onDecided();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async (): Promise<void> => {
    setBusy(true);
    try {
      if (isToolCall) {
        const p = parsePayload(item.payloadJson) as { toolUseId?: string };
        if (p.toolUseId !== undefined) {
          await window.prospero.permissions.resolve(p.toolUseId, {
            behavior: "deny",
            message: comment.trim() || t("decision.m18.defaultRejectMessage"),
          });
        }
      } else {
        if (item.approvalId !== null) {
          await window.prospero.managerRequest.decide(
            item.approvalId,
            "rejected",
            comment.trim() || undefined,
          );
        }
      }
      onDecided();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <DecisionModal
      open={open}
      onClose={onClose}
      header={
        <DecisionHeader
          chip={{ variant: chipVariant, label: chipLabel }}
          meta={t("decision.m18.meta", { requester: requesterName, when: metaWhen })}
          title={item.title}
          compact
        />
      }
      hero={
        <HeroSummary
          variant="brand"
          stats={[
            {
              label: t("decision.m18.stats.requester"),
              value: requesterName,
              ...(isToolCall ? { sub: t("decision.m18.stats.agentSub") } : {}),
            },
            {
              label: t("decision.m18.stats.kind"),
              value: kindLabel,
              sub: kindSub,
            },
          ]}
        />
      }
      sections={[
        <section key="payload">
          <header className="mb-3">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink m-0">
              {t("decision.m18.payloadHeading")}
            </h3>
          </header>
          {item.preview !== null ? (
            <pre className="text-[11px] text-ink-muted bg-surface-soft border border-surface-border rounded p-3 whitespace-pre-wrap break-all overflow-auto max-h-40">
              {item.preview}
            </pre>
          ) : (
            <p className="text-xs text-ink-soft">{t("decision.m18.payloadEmpty")}</p>
          )}
        </section>,

        <section key="comment">
          <header className="mb-3">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink m-0">
              {t("decision.m18.commentHeading")}
            </h3>
          </header>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder={t("decision.m18.commentPlaceholder")}
            className="w-full px-2 py-1 border border-surface-border rounded text-xs bg-surface-card"
          />
        </section>,
      ]}
      actions={
        <DecisionActions
          onApprove={() => void handleApprove()}
          onReject={() => void handleReject()}
          approveLabel={busy ? "…" : t("decision.m18.approveLabel")}
          rejectLabel={busy ? "…" : t("decision.shared.reject")}
          disabled={busy}
        />
      }
    />
  );
};

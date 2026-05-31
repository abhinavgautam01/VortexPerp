import React from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";

export type ActionState = {
  status: "idle" | "pending" | "success" | "error";
  message: string;
  signature?: string;
};

export function Metric({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="metric" data-testid={`metric-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <span>{label}</span>
      <strong className={valueClass}>{value}</strong>
    </div>
  );
}

export function SkeletonMetric() {
  return (
    <div className="metric skeleton" data-testid="skeleton-metric">
      <div className="skeleton-label" />
      <div className="skeleton-value" />
    </div>
  );
}

export function ActionStatus({ state }: { state: ActionState }) {
  return (
    <div className={`action-status ${state.status}`}>
      <CheckCircle2 size={18} />
      <div>
        <strong>{state.status === "pending" ? "Pending" : state.status === "error" ? "Action failed" : "Status"}</strong>
        <span>{state.message}</span>
        {state.signature ? (
          <a href={`https://explorer.solana.com/tx/${state.signature}?cluster=devnet`} target="_blank" rel="noreferrer">
            View transaction <ExternalLink size={13} />
          </a>
        ) : null}
      </div>
    </div>
  );
}

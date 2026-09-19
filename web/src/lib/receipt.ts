import type { Line } from "../types";
import { money } from "./money";

const STOPPED_TEXT = "Stopped: over the listing maximum of 5";

/** Column 1: the proposal, plus each discarded field (struck through by the caller). */
export function proposedText(line: Line) {
  return `${line.name} x ${line.quantity}, "${line.purpose}"`;
}

const discardedLabels: Record<string, (v: unknown) => string> = {
  amount_minor: (v) => `amount ${money(Number(v))}`,
  merchant_id: (v) => `payee ${String(v)}`,
};

export function discardedTexts(line: Line) {
  return Object.entries(line.proposed.discarded).map(([key, value]) =>
    discardedLabels[key] ? discardedLabels[key](value) : `${key} ${String(value)}`,
  );
}

/** Column 2, section 6 table. "Needed approval" is the reason code, which survives approval. */
export function settledText(line: Line) {
  if (line.outcome === "STOPPED" || !line.derived) return STOPPED_TEXT;
  if (line.outcome === "HELD_FOR_REVIEW") return "Held for review by the server";

  const base = `${money(line.derived.amount_minor)} · ${line.derived.supplier}`;
  const neededApproval = line.reason_code === "APPROVAL_REQUIRED";

  switch (line.outcome) {
    case "NEEDS_APPROVAL":
      return `${base} · waiting for the owner`;
    case "PAID":
    case "PAYMENT_FAILED":
      return `${base} · ${neededApproval ? "approved by owner" : "within limits"}`;
    default:
      return `${base} · within limits`;
  }
}

/** Column 3, section 6 table. */
export function paytmText(line: Line) {
  switch (line.outcome) {
    case "PAID":
      return `TXN_SUCCESS · ${money(line.paytm?.amount_minor ?? line.derived?.amount_minor ?? 0)}`;
    case "CONFIRMING":
      return "Waiting for confirmation";
    case "PAYMENT_FAILED":
      return "TXN_FAILURE · nothing charged";
    case "STOPPED":
      return "Nothing sent";
    case "HELD_FOR_REVIEW":
      return "Reported a different amount";
    default:
      return "Not paid yet";
  }
}

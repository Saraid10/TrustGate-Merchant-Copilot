export type Minor = number;
export type Outcome =
  | "READY" | "NEEDS_APPROVAL" | "STOPPED"
  | "PAYING" | "CONFIRMING" | "PAID" | "PAYMENT_FAILED" | "HELD_FOR_REVIEW";
export type AssistantMode = "LIVE" | "OFFLINE" | "COMPROMISED";
export type Rail = "PAYTM_STAGING" | "SIMULATED";

export interface StockRow {
  sku: string; name: string; on_hand: number; reorder_at: number;
  status: "OK" | "LOW" | "OUT";
}

export interface Store {
  store: { name: string; area: string; synthetic: true };
  budget: { daily_limit_minor: Minor; spent_today_minor: Minor; approval_above_minor: Minor };
  rail: Rail;
  assistant_mode: AssistantMode;
  stock: StockRow[];
  suggestions: { text: string; needs_live: boolean }[];
}

export interface Line {
  id: string;
  sku: string;
  name: string | null;
  quantity: number;
  purpose: string;
  proposed: { sku: string; quantity: number; purpose: string; discarded: Record<string, unknown> };
  derived: { unit_price_minor: Minor; amount_minor: Minor; supplier: string } | null;
  outcome: Outcome;
  reason_code: string | null;
  reason_text: string | null;
  payment_request_id: string | null;
  paytm: { order_id: string; status: string; amount_minor: Minor } | null;
}

export interface Basket {
  id: string;
  goal: string;
  created_at: string;
  assistant: { mode_used: AssistantMode; model: string | null; note: string };
  totals: { ready_minor: Minor; waiting_minor: Minor; paid_minor: Minor;
            stopped_count: number; blocked_minor: Minor };
  budget_after_minor: Minor;
  lines: Line[];
}

export interface HoodEvent {
  id: string; at: string;
  actor: "ASSISTANT" | "SERVER" | "OWNER" | "PAYTM";
  tone: "info" | "good" | "warn" | "stop";
  title: string;
  line_id: string | null;
  raw: Record<string, unknown>;
}

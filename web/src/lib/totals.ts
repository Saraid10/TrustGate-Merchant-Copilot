import type { Basket, Line, Outcome, Store } from "../types";

const READY_LIKE: Outcome[] = ["READY", "PAYING", "CONFIRMING", "PAYMENT_FAILED"];

const amount = (l: Line) => l.derived?.amount_minor ?? 0;
const sum = (lines: Line[], outcomes: Outcome[]) =>
  lines.filter((l) => outcomes.includes(l.outcome)).reduce((s, l) => s + amount(l), 0);

/** Section 6: the sample totals are starting values only; everything is derived from the lines. */
export function totals(basket: Basket, store: Store) {
  const { lines } = basket;
  const ready = sum(lines, READY_LIKE);
  const waiting = sum(lines, ["NEEDS_APPROVAL"]);
  const paid = sum(lines, ["PAID"]);
  const stopped = lines.filter((l) => l.outcome === "STOPPED");
  const blocked = stopped.reduce((s, l) => s + (Number(l.proposed.discarded.amount_minor) || 0), 0);

  return {
    ready,
    waiting,
    paid,
    stoppedCount: stopped.length,
    blocked,
    budgetUsed: store.budget.spent_today_minor + ready + waiting + paid,
    decisionsAsked: lines.filter((l) => l.reason_code === "APPROVAL_REQUIRED").length,
  };
}

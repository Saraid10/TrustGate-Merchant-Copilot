import type { AssistantMode, Basket, HoodEvent, Line, Rail, Store } from "./types";
import { money } from "./lib/money";
import storeJson from "./fixtures/store.json";
import basketClean from "./fixtures/basket-clean.json";
import basketCompromised from "./fixtures/basket-compromised.json";
import eventsJson from "./fixtures/events.json";

/**
 * Real backend by default in a build (served from the backend at /app); sample data in
 * `npm run dev`. Keep the sample-data path: it is the fallback if the backend is down.
 * Override either way with VITE_USE_FIXTURES=true|false, or add ?fixtures=1 to the page URL.
 */
export const USE_FIXTURES =
  new URLSearchParams(window.location.search).get("fixtures") === "1" ||
  (import.meta.env.VITE_USE_FIXTURES ?? (import.meta.env.DEV ? "true" : "false")) === "true";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const normalise = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const events = eventsJson as HoodEvent[];

/** A non-2xx answer from the backend, with its status and body kept for the caller. */
export class ApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
    this.status = status;
    this.body = body;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body?: unknown) =>
  call<T>(path, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export async function getStore(): Promise<Store> {
  if (USE_FIXTURES) { await wait(150); return storeJson as Store; }
  return call<Store>("/api/v1/merchant/store");
}

/**
 * Switch the assistant's mode on the server. The top bar chip is driven from the store this
 * returns, never from local state, so it can only turn red after the server has.
 */
export async function setAssistantMode(mode: AssistantMode): Promise<Store> {
  if (USE_FIXTURES) { await wait(120); return { ...(storeJson as Store), assistant_mode: mode }; }
  return post<Store>("/api/v1/merchant/demo/mode", { assistant_mode: mode });
}

export async function createBasket(goal: string, mode: AssistantMode): Promise<Basket> {
  if (USE_FIXTURES) {
    await wait(900);                                  // feels like the assistant thinking
    const basket = structuredClone(
      mode === "COMPROMISED" ? basketCompromised : basketClean,
    ) as Basket;
    // The sample data only has a basket for the restock goal. Say so rather than pretend other
    // requests were understood. With the real backend, every goal goes to the real assistant.
    if (normalise(goal) !== normalise(basket.goal)) {
      basket.assistant.note =
        "This demo only has restock data, so here's what's running low.";
    }
    basket.goal = goal;
    if (mode === "OFFLINE") {
      basket.assistant = { mode_used: "OFFLINE", model: null, note: basket.assistant.note };
    }
    return basket;
  }
  // The server already knows the mode (setAssistantMode), so only the goal is sent.
  return post<Basket>("/api/v1/merchant/baskets", { goal });
}

export async function approveLine(line: Line): Promise<Line> {
  if (USE_FIXTURES) {
    await wait(350);
    return { ...line, outcome: "READY", reason_text: "Approved by you. Within your limits." };
  }
  return post<Line>(`/api/v1/merchant/lines/${line.id}/approve`);
}

export interface Checkout {
  mid: string;
  order_id: string;
  txn_token: string;
  amount: string;
  host: string;
}

export interface PayStart {
  rail: Rail;
  line: Line;
  /** Null on sample data, where the modal shows its own three buttons instead of a checkout. */
  checkout: Checkout | null;
}

/**
 * Called when the pay modal opens. On the real backend this consumes the one-time payment
 * authority and creates the Paytm order, so from here on only the server knows the outcome.
 */
export async function startPayment(line: Line): Promise<PayStart> {
  if (USE_FIXTURES) {
    await wait(80);
    return { rail: "SIMULATED", line: { ...line, outcome: "PAYING" }, checkout: null };
  }
  return post<PayStart>(`/api/v1/merchant/lines/${line.id}/pay`);
}

export const checkoutUrl = (c: Checkout) =>
  `${c.host.replace(/\/$/, "")}/sim/checkout?orderId=${encodeURIComponent(c.order_id)}&txnToken=${encodeURIComponent(c.txn_token)}`;

/** A stable, different-looking order id per line, so three paid lines do not share one id. */
const orderId = (line: Line) =>
  "TG" +
  (Array.from(line.id).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) >>> 0)
    .toString(16).toUpperCase().padStart(6, "0").slice(0, 6);

/** Asks the server to check with Paytm. Throws ApiError 409 if no order exists yet. */
export async function confirmLine(line: Line): Promise<Line> {
  if (USE_FIXTURES) {
    await wait(1200);
    return { ...line, outcome: "PAID",
             paytm: { order_id: orderId(line), status: "TXN_SUCCESS",
                      amount_minor: line.derived?.amount_minor ?? 0 } };
  }
  return post<Line>(`/api/v1/merchant/lines/${line.id}/confirm`);
}

/* ---------------------------------------------------------------- the live record

The real server streams events over SSE as they actually happen. In fixture mode there is no
server, so the UI asks for the right batch at the right moment. These ids group the sample
events by the part of the journey they belong to.                                            */

const PLAN_BOTH = ["e1", "e2", "e3", "e4", "e5", "e6"];
const PLAN_CLEAN = ["e7", "e8"];
const PLAN_COMPROMISED = ["e14", "e15", "e16"];
const ON_APPROVE = ["e9"];
const ON_PAY_START = ["e10", "e11"];
const ON_AUTO_PAY = ["e17", "e10", "e11"];
const ON_PAY_CONFIRMED = ["e12", "e13"];

let listener: ((e: HoodEvent) => void) | null = null;
let runId = 0;

export function subscribeEvents(onEvent: (e: HoodEvent) => void): () => void {
  if (USE_FIXTURES) {
    listener = onEvent;
    return () => { listener = null; };
  }
  const es = new EventSource("/api/v1/merchant/events");
  es.addEventListener("tg", (m) => onEvent(JSON.parse((m as MessageEvent).data)));
  return () => es.close();
}

/** Sample events carry fixed times. Replace them with the moment they play, so the log is
    always in order and matches the phone's clock. The real server sends its own times. */
const stamp = (e: HoodEvent): HoodEvent => ({
  ...e,
  at: new Date().toLocaleTimeString("en-GB", { hour12: false }),
});

/** Pressing R calls this. Any replay still in flight stops immediately. */
export function cancelReplays() { runId += 1; }

async function replay(ids: string[], fill?: (e: HoodEvent) => HoodEvent, gap = 400) {
  if (!USE_FIXTURES || !listener) return;   // with the real backend these are no-ops
  const mine = runId;
  for (const id of ids) {
    if (mine !== runId || !listener) return;   // a reset happened, drop the rest
    const found = events.find((e) => e.id === id);
    if (found) listener(stamp(fill ? fill(structuredClone(found)) : found));
    await wait(gap);
  }
}

/** The sample payment events are written for the toor dal. Retarget them at whichever line
    is actually being paid, so the amounts on screen are never wrong. */
const forLine = (line: Line) => (e: HoodEvent): HoodEvent => {
  const amount = line.derived?.amount_minor ?? 0;
  return {
    ...e,
    line_id: line.id,
    title: e.title.replace("{amount}", money(amount)),
    raw: {
      ...e.raw,
      ...("amount_minor" in e.raw ? { amount_minor: amount } : {}),
      ...("txnAmount" in e.raw ? { txnAmount: (amount / 100).toFixed(2) } : {}),
      ...("order_id" in e.raw ? { order_id: orderId(line) } : {}),
    },
  };
};

// Plays from the moment planning starts, 250ms apart, so the basket reveal finishes in about
// two seconds (section 5 allows 2.5).
export const replayPlan = (mode: AssistantMode) =>
  replay([...PLAN_BOTH, ...(mode === "COMPROMISED" ? PLAN_COMPROMISED : PLAN_CLEAN)], undefined, 250);
export const replayApprove = () => replay(ON_APPROVE);
export const replayPayStart = (line: Line) => replay(ON_PAY_START, forLine(line));
export const replayAutoPay = (line: Line) => replay(ON_AUTO_PAY, forLine(line));
export const replayPayConfirmed = (line: Line) => replay(ON_PAY_CONFIRMED, forLine(line));

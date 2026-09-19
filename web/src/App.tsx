import { useEffect, useReducer, useRef, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  USE_FIXTURES, approveLine, cancelReplays, checkoutUrl, confirmLine, createBasket, getStore,
  setAssistantMode, startPayment,
  replayApprove, replayAutoPay, replayPayConfirmed, replayPayStart, replayPlan, subscribeEvents,
} from "./api";
import { decidedLines, effectiveMode, initialState, reducer, type Screen } from "./state";
import type { AssistantMode, Line } from "./types";
import { ApprovalSheet } from "./phone/ApprovalSheet";
import { PayModal, type PayChoice } from "./phone/PayModal";
import { Receipt } from "./phone/Receipt";
import { totals } from "./lib/totals";
import { injectedSuppliers } from "./lib/listing";
import { fromVerifiedSupplier } from "./lib/supplier";
import { PresenterBar } from "./presenter/PresenterBar";
import { SHOW_SCORECARD } from "./config";
import { CHECKOUT_RETURN } from "./lib/checkout";
import { PhoneFrame } from "./ui/PhoneFrame";
import { Logo } from "./ui/Logo";
import { Home } from "./phone/Home";
import { Compose } from "./phone/Compose";
import { Basket } from "./phone/Basket";
import { HoodPanel } from "./hood/HoodPanel";

const order: Screen[] = ["HOME", "COMPOSE", "PLANNING", "BASKET", "RECEIPT"];
const PRESENTER_ROOM = 64;
const REVEAL_FALLBACK_MS = 2500;
const AUTO_PAY_DELAY_MS = 900;

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const journey = useRef(0);
  const prevScreen = useRef<Screen>(state.screen);
  const direction = order.indexOf(state.screen) >= order.indexOf(prevScreen.current) ? 1 : -1;

  useEffect(() => {
    prevScreen.current = state.screen;
  }, [state.screen]);

  useEffect(() => {
    getStore()
      .then((store) => dispatch({ type: "STORE_LOADED", store }))
      .catch(() => dispatch({ type: "STORE_FAILED" }));
  }, []);

  useEffect(() => subscribeEvents((event) => dispatch({ type: "ADD_EVENT", event })), []);

  /** Stop everything in flight for the current basket: replays, payments, auto-pay timers. */
  function abandonJourney() {
    cancelReplays();
    journey.current += 1;
    busyLines.current.clear();
    autoStarted.current.clear();
  }

  function reset() {
    abandonJourney();
    dispatch({ type: "RESET" });
  }

  /** Back from the basket: edit the request and plan again. The goal stays in the box. */
  function backToCompose() {
    abandonJourney();
    dispatch({ type: "GO", screen: "COMPOSE" });
  }

  // Handlers registered once (keys, checkout messages) read the latest state through this.
  const latest = useRef(state);
  latest.current = state;

  /**
   * Ask the server to switch the assistant's mode. The chip only changes from the store the
   * server sends back; if the call fails, nothing changes, so the chip can never be red while
   * the server is still clean.
   */
  const modeInFlight = useRef(false);
  async function changeMode(target: AssistantMode) {
    if (modeInFlight.current) return;
    modeInFlight.current = true;
    try {
      const store = await setAssistantMode(target);
      dispatch({ type: "MODE_FROM_SERVER", store });
    } catch {
      // Leave the chip as it is: the server did not change.
    } finally {
      modeInFlight.current = false;
    }
  }
  const toggleCompromise = () => {
    const s = latest.current;
    changeMode(s.compromised ? s.baseMode : "COMPROMISED");
  };
  // LIVE and OFFLINE alternate. From COMPROMISED this also ends the compromise.
  const cycleMode = () => changeMode(latest.current.baseMode === "LIVE" ? "OFFLINE" : "LIVE");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing) return;

      switch (e.key.toLowerCase()) {
        case "r": reset(); break;
        case "c": toggleCompromise(); break;
        case "l": cycleMode(); break;
        case "d": dispatch({ type: "TOGGLE_PRESENTER" }); break;
        case "1": dispatch({ type: "SET_TAB", tab: "LIVE" }); break;
        case "2": dispatch({ type: "SET_TAB", tab: "ENDINGS" }); break;
        case "3": if (!SHOW_SCORECARD) return; dispatch({ type: "SET_TAB", tab: "SCORECARD" }); break;
        default: return;
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const requestMode: AssistantMode = state.compromised ? "COMPROMISED" : state.baseMode;

  async function plan() {
    const mine = ++journey.current;
    autoStarted.current.clear();
    dispatch({ type: "GO", screen: "PLANNING" });
    // The record plays while the assistant thinks, and each card waits for the server's verdict
    // on it, so the gate visibly acts before the result appears.
    replayPlan(requestMode);
    let basket;
    try {
      basket = await createBasket(state.goal, requestMode);
    } catch {
      // Back to Compose with the goal kept, rather than skeletons that never resolve.
      if (mine === journey.current) dispatch({ type: "GO", screen: "COMPOSE" });
      return;
    }
    if (mine !== journey.current) return;
    dispatch({ type: "SET_BASKET", basket });
    dispatch({ type: "GO", screen: "BASKET" });
    // If verdicts are late or never come (a real backend may not stream one per line), show
    // every card anyway rather than leave skeletons on screen.
    setTimeout(() => {
      if (mine === journey.current) dispatch({ type: "REVEAL_ALL" });
    }, REVEAL_FALLBACK_MS);
  }

  const isCurrent = (mine: number) => mine === journey.current;

  /** Lines with a checkout open or a confirmation in flight. Stops a double tap from paying twice. */
  const busyLines = useRef(new Set<string>());

  /** A line whose Paytm order exists but isn't confirmed: say so, and offer Check again. */
  function markUnconfirmed(line: Line) {
    busyLines.current.delete(line.id);
    dispatch({ type: "UPDATE_LINE", line: { ...line, outcome: "CONFIRMING" } });
    dispatch({ type: "SET_PENDING", lineId: line.id, pending: true });
  }

  async function openPay(line: Line) {
    if (busyLines.current.has(line.id) || autoEligible(line)) return;
    busyLines.current.add(line.id);
    const mine = journey.current;
    let started;
    try {
      // On the real backend this creates the Paytm order, so the modal opens only once it exists.
      started = await startPayment(line);
    } catch {
      busyLines.current.delete(line.id);
      return;
    }
    if (!isCurrent(mine)) return;
    dispatch({ type: "UPDATE_LINE", line: { ...started.line, outcome: "PAYING" } });
    dispatch({
      type: "OPEN_OVERLAY",
      overlay: {
        kind: "PAY",
        lineId: line.id,
        rail: started.rail,
        checkout: started.checkout ? checkoutUrl(started.checkout) : undefined,
      },
    });
  }

  async function confirm(line: Line) {
    const mine = journey.current;
    busyLines.current.add(line.id);
    dispatch({ type: "SET_PENDING", lineId: line.id, pending: false });
    dispatch({ type: "UPDATE_LINE", line: { ...line, outcome: "CONFIRMING" } });
    let result: Line;
    try {
      result = await confirmLine(line);
    } catch {
      // 409 NOTHING_TO_CONFIRM, or the server is unreachable: nothing is known to be paid.
      if (isCurrent(mine)) markUnconfirmed(line);
      return;
    }
    if (!isCurrent(mine)) return;
    if (result.outcome === "CONFIRMING") {
      markUnconfirmed(result);
      return;
    }
    busyLines.current.delete(line.id);
    dispatch({ type: "UPDATE_LINE", line: result });
    replayPayConfirmed(line);
  }

  // The real checkout runs in an iframe inside the pay modal. When Paytm's callback redirects
  // back to /app, that copy of the app tells this one (see main.tsx); then ask the server.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data?.type !== CHECKOUT_RETURN) return;
      const s = latest.current;
      if (s.overlay?.kind !== "PAY" || !s.overlay.checkout) return;
      const trusted = [window.location.origin, new URL(s.overlay.checkout).origin];
      if (!trusted.includes(e.origin)) return;
      const line = s.basket?.lines.find((l) => l.id === s.overlay?.lineId);
      dispatch({ type: "CLOSE_OVERLAY" });
      if (line) confirmRef.current(line);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;

  /**
   * Ready lines from a verified supplier pay themselves once the basket has settled. Lines from
   * an unverified supplier still wait for the owner's tap, and anything over the limit still
   * waits for approval first (then pays itself if its supplier is verified). Sample data only:
   * on the real backend every payment goes through the checkout.
   */
  const autoStarted = useRef(new Set<string>());
  function autoPay(line: Line) {
    busyLines.current.add(line.id);
    dispatch({ type: "SET_AUTO", lineId: line.id });
    replayAutoPay(line);
    confirm(line);
  }
  const autoPayRef = useRef(autoPay);
  autoPayRef.current = autoPay;

  function checkAgain(line: Line) {
    if (busyLines.current.has(line.id)) return;
    confirm(line);
  }

  function choosePay(line: Line, choice: PayChoice) {
    dispatch({ type: "CLOSE_OVERLAY" });
    if (choice === "CANCEL") {
      if (USE_FIXTURES) {
        // Sample data creates no order, so the line can honestly go back to Ready.
        busyLines.current.delete(line.id);
        dispatch({ type: "UPDATE_LINE", line: { ...line, outcome: "READY" } });
      } else {
        // On the real backend the Paytm order already exists. Only the server knows its fate,
        // so the UI doesn't pretend: not confirmed, check again.
        markUnconfirmed(line);
      }
      return;
    }
    // The Paytm order exists once the owner commits, whatever the outcome.
    replayPayStart(line);
    if (choice === "PAY") {
      confirm(line);
    } else if (choice === "PENDING") {
      busyLines.current.delete(line.id);
      dispatch({ type: "UPDATE_LINE", line: { ...line, outcome: "CONFIRMING" } });
      dispatch({ type: "SET_PENDING", lineId: line.id, pending: true });
    } else {
      busyLines.current.delete(line.id);
      dispatch({ type: "UPDATE_LINE", line: { ...line, outcome: "PAYMENT_FAILED" } });
    }
  }

  async function approve(line: Line) {
    const mine = journey.current;
    let approved;
    try {
      approved = await approveLine(line);
    } catch {
      // Not approved: close the sheet and leave the card amber.
      if (isCurrent(mine)) dispatch({ type: "CLOSE_OVERLAY" });
      return;
    }
    if (!isCurrent(mine)) return;
    dispatch({ type: "CLOSE_OVERLAY" });
    dispatch({ type: "UPDATE_LINE", line: approved });
    replayApprove();
  }

  const decided = decidedLines(state);
  const revealed = new Set(
    (state.basket?.lines ?? []).filter((l) => state.revealAll || decided.has(l.id)).map((l) => l.id),
  );
  const allRevealed = !!state.basket && revealed.size === state.basket.lines.length;

  const autoEligible = (l: Line) => USE_FIXTURES && l.outcome === "READY" && fromVerifiedSupplier(l);

  useEffect(() => {
    if (!allRevealed || !state.basket || state.screen !== "BASKET") return;
    const due = state.basket.lines.filter((l) => autoEligible(l) && !autoStarted.current.has(l.id));
    if (due.length === 0) return;
    for (const l of due) autoStarted.current.add(l.id);
    const mine = journey.current;
    // A beat after the card lands, so the audience sees it is Ready before it pays.
    // No cleanup: this effect re-runs on every event, and the journey check covers resets.
    setTimeout(() => {
      if (mine !== journey.current) return;
      for (const l of due) {
        const current = latest.current.basket?.lines.find((x) => x.id === l.id);
        if (current && autoEligible(current)) autoPayRef.current(current);
      }
    }, AUTO_PAY_DELAY_MS);
  });

  // Counters wait for the full reveal, so ₹20,000 never lands before the stopped card does.
  const hood =
    allRevealed && state.basket && state.store
      ? totals(state.basket, state.store)
      : { blocked: 0, decisionsAsked: 0 };

  const overlayLine = state.basket?.lines.find((l) => l.id === state.overlay?.lineId) ?? null;

  let screen: ReactNode = null;
  if (state.screen === "HOME") {
    screen = (
      <Home
        store={state.store}
        error={state.storeError}
        onRestock={() => dispatch({ type: "GO", screen: "COMPOSE" })}
      />
    );
  } else if (state.screen === "COMPOSE" && state.store) {
    screen = (
      <Compose
        store={state.store}
        goal={state.goal}
        showLiveOnly={state.baseMode === "LIVE" && !state.compromised}
        onGoal={(goal) => dispatch({ type: "SET_GOAL", goal })}
        onBack={() => dispatch({ type: "GO", screen: "HOME" })}
        onPlan={plan}
      />
    );
  } else if ((state.screen === "PLANNING" || state.screen === "BASKET") && state.store) {
    screen = (
      <Basket
        store={state.store}
        basket={state.screen === "BASKET" ? state.basket : null}
        revealed={revealed}
        autoPay={new Set((state.basket?.lines ?? []).filter((l) => state.auto[l.id] || autoEligible(l)).map((l) => l.id))}
        onBack={backToCompose}
        injectedFrom={injectedSuppliers(state.events.slice(state.planFrom))}
        pending={state.pending}
        onPay={openPay}
        onReview={(line) => dispatch({ type: "OPEN_OVERLAY", overlay: { kind: "APPROVE", lineId: line.id } })}
        onCheckAgain={checkAgain}
        onTryAgain={(line) => dispatch({ type: "UPDATE_LINE", line: { ...line, outcome: "READY" } })}
        onReceipt={() => dispatch({ type: "GO", screen: "RECEIPT" })}
      />
    );
  } else if (state.screen === "RECEIPT" && state.basket) {
    screen = <Receipt basket={state.basket} onBack={() => dispatch({ type: "GO", screen: "BASKET" })} />;
  }

  return (
    <div className="stage flex h-full flex-col text-white">
      <TopBar mode={effectiveMode(state)} rail={state.store?.rail ?? "SIMULATED"} />

      <main className="flex min-h-0 flex-1 gap-6 px-6 pb-6">
        <div className="flex w-[38%] items-center justify-center">
          <PhoneFrame reserve={state.presenterOpen ? PRESENTER_ROOM : 0}>
            {/* Keyed by reset count: R throws away everything on the phone at once, mid-animation or not. */}
            <div key={state.resetCount} className="absolute inset-0">
              <ScreenTransition id={state.screen === "PLANNING" ? "BASKET" : state.screen} direction={direction}>
                {screen}
              </ScreenTransition>
              <AnimatePresence>
                {state.screen === "BASKET" && state.store && state.overlay?.kind === "APPROVE" && overlayLine && (
                  <ApprovalSheet
                    key="approve"
                    line={overlayLine}
                    store={state.store}
                    onApprove={() => approve(overlayLine)}
                    onClose={() => dispatch({ type: "CLOSE_OVERLAY" })}
                  />
                )}
                {state.screen === "BASKET" && state.overlay?.kind === "PAY" && overlayLine && (
                  <PayModal
                    key="pay"
                    line={overlayLine}
                    checkout={state.overlay.checkout}
                    rail={state.overlay.rail}
                    onChoose={(choice) => choosePay(overlayLine, choice)}
                  />
                )}
              </AnimatePresence>
            </div>
          </PhoneFrame>
        </div>
        <div className="w-[62%] min-w-0">
          <HoodPanel
            tab={state.tab}
            onTab={(tab) => dispatch({ type: "SET_TAB", tab })}
            events={state.events}
            settled={allRevealed}
            blocked={hood.blocked}
            decisions={hood.decisionsAsked}
          />
        </div>
      </main>

      {/* The presenter bar gets its own strip, so it never covers the counters or the phone. */}
      {state.presenterOpen && <div aria-hidden className="shrink-0" style={{ height: PRESENTER_ROOM }} />}

      <AnimatePresence>
        {state.presenterOpen && (
          <PresenterBar
            compromised={state.compromised}
            baseMode={state.baseMode}
            onReset={reset}
            onCompromise={toggleCompromise}
            onMode={cycleMode}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ScreenTransition({ id, direction, children }: { id: string; direction: number; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence mode="wait" initial={false} custom={direction}>
      <motion.div
        key={id}
        custom={direction}
        className="absolute inset-0"
        initial={reduce ? false : { x: 40 * direction, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={reduce ? { opacity: 0 } : { x: -40 * direction, opacity: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

const modeChip: Record<AssistantMode, string> = {
  LIVE: "border-[var(--tg-cyan)]/50 text-[var(--tg-cyan)]",
  OFFLINE: "border-white/25 text-white/70",
  COMPROMISED: "border-[var(--tg-red)] bg-[var(--tg-red)] text-white shadow-[0_0_20px_rgba(207,68,57,0.5)]",
};

const modeDot: Record<AssistantMode, string> = {
  LIVE: "bg-[var(--tg-cyan)]",
  OFFLINE: "bg-white/50",
  COMPROMISED: "bg-white",
};

const railLabel: Record<string, string> = { SIMULATED: "Paytm: test mode", PAYTM_STAGING: "Paytm: staging" };

/** On sample data the assistant isn't live, so the chip doesn't claim it is. */
function modeLabel(mode: AssistantMode) {
  if (mode === "LIVE" && USE_FIXTURES) return "sample data";
  return mode;
}

function TopBar({ mode, rail }: { mode: AssistantMode; rail: string }) {
  return (
    <header className="flex h-[72px] shrink-0 items-center justify-between px-6">
      <div className="flex items-center gap-3">
        <Logo size={34} />
        <div className="flex items-baseline gap-4">
          <h1 className="whitespace-nowrap text-[20px] font-semibold tracking-tight">TrustGate Merchant Copilot</h1>
          {/* Hidden on narrow screens (projectors at 1024) so the bar never wraps. */}
          <p className="hidden whitespace-nowrap text-[15px] text-white/55 xl:block">"The assistant proposes. The server decides."</p>
        </div>
      </div>
      <div className="flex items-center gap-2 whitespace-nowrap text-[13px] font-medium">
        <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-white/80">
          Nandi Kirana Store · synthetic
        </span>
        <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-white/80">{railLabel[rail] ?? rail}</span>
        <motion.span
          key={mode}
          initial={{ scale: 0.92 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 22 }}
          className={`flex items-center gap-2 rounded-full border px-3 py-1 transition-colors ${modeChip[mode]}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${modeDot[mode]}`} />
          Assistant: {modeLabel(mode)}
        </motion.span>
      </div>
    </header>
  );
}

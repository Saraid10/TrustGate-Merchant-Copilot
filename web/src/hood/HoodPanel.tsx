import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Tab } from "../state";
import type { HoodEvent } from "../types";
import { TrustBoundary } from "./TrustBoundary";
import { LiveRecord } from "./LiveRecord";
import { Counters } from "./Counters";
import { TwoEndings } from "./TwoEndings";
import { Scorecard } from "./Scorecard";
import { Thesis } from "./Thesis";
import { StopBanner } from "./StopBanner";
import { SHOW_SCORECARD } from "../config";

const allTabs: { id: Tab; label: string }[] = [
  { id: "LIVE", label: "Live" },
  { id: "ENDINGS", label: "Two endings" },
  { id: "SCORECARD", label: "Scorecard" },
];
const tabs = allTabs.filter((t) => SHOW_SCORECARD || t.id !== "SCORECARD");

// Let the strike-through at the gate land first, then hold the banner long enough to read aloud.
const BANNER_DELAY_MS = 1500;
const BANNER_HOLD_MS = 5000;

interface Props {
  tab: Tab;
  onTab: (t: Tab) => void;
  events: HoodEvent[];
  /** True once every card of the current basket is on screen. Counters wait for it. */
  settled: boolean;
  blocked: number;
  decisions: number;
}

export function HoodPanel({ tab, onTab, events, settled, blocked, decisions }: Props) {
  const reduce = useReducedMotion();
  const [banner, setBanner] = useState(false);
  const [endingsHint, setEndingsHint] = useState(false);
  const wasBlocked = useRef(0);

  // Show the banner once each time money is newly stopped. A reset (blocked back to 0) clears it.
  useEffect(() => {
    const before = wasBlocked.current;
    wasBlocked.current = blocked;
    if (blocked === 0) {
      setBanner(false);
      setEndingsHint(false);
      return;
    }
    if (before > 0) return;
    const show = setTimeout(() => {
      setBanner(true);
      setEndingsHint(true);
    }, BANNER_DELAY_MS);
    const hide = setTimeout(() => setBanner(false), BANNER_DELAY_MS + BANNER_HOLD_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [blocked]);

  useEffect(() => {
    if (tab === "ENDINGS") setEndingsHint(false);
  }, [tab]);

  const lastProposal = [...events].reverse().find((e) => e.actor === "ASSISTANT");
  const payee = typeof lastProposal?.raw.merchant_id === "string" ? lastProposal.raw.merchant_id : null;

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--tg-line)] bg-[var(--tg-stage-raised)]/90 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur">
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--tg-line)] px-6 py-3.5">
        <h2 className="text-[17px] font-semibold text-white/85">What the server decided</h2>
        <div className="flex gap-1 rounded-xl bg-[var(--tg-stage)] p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTab(t.id)}
              className="relative rounded-lg px-4 py-1.5 text-[15px] font-medium"
            >
              {tab === t.id && (
                <motion.span
                  layoutId="hood-tab"
                  className="absolute inset-0 rounded-lg bg-white"
                  transition={{ type: "spring", stiffness: 500, damping: 38 }}
                />
              )}
              <span className={`relative transition-colors ${tab === t.id ? "text-[var(--tg-stage)]" : "text-white/60 hover:text-white"}`}>
                {t.label}
              </span>
              {t.id === "ENDINGS" && endingsHint && tab !== "ENDINGS" && (
                <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                  {!reduce && <span className="absolute inset-0 animate-ping rounded-full bg-[var(--tg-red)] opacity-70" />}
                  <span className="relative h-2.5 w-2.5 rounded-full bg-[var(--tg-red)]" />
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            className="flex min-h-0 flex-1 flex-col gap-4 p-5"
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {tab === "LIVE" &&
              (events.length === 0 ? (
                <Thesis />
              ) : (
                <>
                  <TrustBoundary events={events} />
                  <LiveRecord events={events} />
                  {settled && <Counters blocked={blocked} decisions={decisions} />}
                </>
              ))}
            {tab === "ENDINGS" && <TwoEndings />}
            {tab === "SCORECARD" && SHOW_SCORECARD && <Scorecard />}
          </motion.div>
        </AnimatePresence>

        <AnimatePresence>
          {banner && tab === "LIVE" && (
            <StopBanner
              blocked={blocked}
              payee={payee}
              onDismiss={() => setBanner(false)}
              onEndings={() => {
                setBanner(false);
                onTab("ENDINGS");
              }}
            />
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

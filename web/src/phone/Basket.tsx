import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronLeft, ReceiptText } from "lucide-react";
import type { Basket as BasketT, Line, Store } from "../types";
import { money } from "../lib/money";
import { totals } from "../lib/totals";
import { AssistantAvatar } from "../ui/AssistantAvatar";
import { LineCard } from "./LineCard";

interface Props {
  store: Store;
  basket: BasketT | null;
  onPay: (line: Line) => void;
  onReview: (line: Line) => void;
  onCheckAgain: (line: Line) => void;
  onTryAgain: (line: Line) => void;
  onReceipt: () => void;
  pending: Record<string, boolean>;
  /** Lines the server has ruled on. Others stay as skeletons until their verdict arrives. */
  revealed: Set<string>;
  /** Line id to the supplier whose listing carried a hidden instruction. */
  injectedFrom: Record<string, string>;
  /** Lines that pay themselves (Ready, verified supplier). */
  autoPay: Set<string>;
  onBack: () => void;
}

/** P3 Planning and P4 Basket share one screen, so each skeleton turns into its real card in place. */
export function Basket(props: Props) {
  const { store, basket, pending, revealed, injectedFrom, autoPay, onBack, onPay, onReview, onCheckAgain, onTryAgain, onReceipt } = props;
  const reduce = useReducedMotion();
  const fellBack = basket?.assistant.mode_used === "OFFLINE";
  const done = !!basket && basket.lines.every((l) => revealed.has(l.id));

  return (
    <div className="flex h-full flex-col pt-14">
      <header className="min-h-[40px] px-5">
        <AnimatePresence mode="wait" initial={false}>
          {done ? (
            <motion.div
              key="goal"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              className="-ml-2 flex items-start gap-1"
            >
              <button
                type="button"
                onClick={onBack}
                aria-label="Back"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--tg-ink)] transition-colors hover:bg-black/5"
              >
                <ChevronLeft size={22} />
              </button>
              <p className="pt-1.5 text-[13px] leading-snug text-[var(--tg-muted)]">"{basket?.goal}"</p>
            </motion.div>
          ) : (
            <motion.div key="reading" exit={{ opacity: 0 }} className="flex items-center gap-3">
              <AssistantAvatar size={44} thinking />
              <p className="font-medium">Reading your stock and supplier listings...</p>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 pt-2 [scrollbar-width:none]">
        {done && basket?.assistant.note && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-3 flex items-start gap-2.5"
          >
            <AssistantAvatar size={28} />
            <p className="rounded-2xl rounded-tl-md bg-[var(--tg-cyan)]/10 px-3.5 py-2.5 text-[14px] leading-snug">
              {basket.assistant.note}
            </p>
          </motion.div>
        )}
        {done && fellBack && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-3 flex items-start gap-2.5"
          >
            <AssistantAvatar size={28} />
            <p className="rounded-2xl rounded-tl-md bg-[var(--tg-cyan)]/10 px-3.5 py-2.5 text-[14px] leading-snug">
              The online assistant is slow, so I used the offline planner.
            </p>
          </motion.div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5">
          {[0, 1, 2].map((i) => {
            const line = basket?.lines[i];
            const shown = line && revealed.has(line.id);
            return line && shown ? (
              <motion.div
                key={line.id}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <LineCard
                  line={line}
                  injectedFrom={injectedFrom[line.id]}
                  autoPay={autoPay.has(line.id)}
                  pending={pending[line.id]}
                  onPay={onPay}
                  onReview={onReview}
                  onCheckAgain={onCheckAgain}
                  onTryAgain={onTryAgain}
                />
              </motion.div>
            ) : (
              <SkeletonCard key={`skeleton-${i}`} index={i} />
            );
          })}
        </div>
      </div>

      {done && basket && <Footer store={store} basket={basket} onReceipt={onReceipt} />}
    </div>
  );
}

function Footer({ store, basket, onReceipt }: { store: Store; basket: BasketT; onReceipt: () => void }) {
  const reduce = useReducedMotion();
  const t = totals(basket, store);
  const limit = store.budget.daily_limit_minor;

  const segments = [
    t.ready > 0 && { key: "ready", dot: "bg-[var(--tg-green)]", text: `Ready ${money(t.ready)}` },
    t.waiting > 0 && { key: "waiting", dot: "bg-[var(--tg-amber)]", text: `Waiting on you ${money(t.waiting)}` },
    t.paid > 0 && { key: "paid", dot: "bg-[var(--tg-green)]", text: `Paid ${money(t.paid)}` },
    t.stoppedCount > 0 && {
      key: "stopped",
      dot: "bg-[var(--tg-red)]",
      text: `Stopped ${t.stoppedCount} ${t.stoppedCount === 1 ? "item" : "items"} · ${money(t.blocked)} did not move`,
    },
  ].filter((s): s is { key: string; dot: string; text: string } => Boolean(s));

  const bar = [
    { key: "paid", value: t.paid, color: "var(--tg-green)" },
    { key: "ready", value: t.ready, color: "color-mix(in srgb, var(--tg-green) 45%, white)" },
    { key: "waiting", value: t.waiting, color: "var(--tg-amber)" },
  ];

  return (
    <motion.footer
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.45, duration: 0.3 }}
      className="border-t border-[#E4EAF2] bg-white px-5 pb-5 pt-3 shadow-[0_-8px_24px_rgba(18,33,58,0.05)]"
    >
      <p className="tabular flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[14px] font-semibold">
        {segments.map((s, i) => (
          <motion.span key={s.key} layout className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${s.dot}`} />
            <span className={s.key === "stopped" ? "text-[var(--tg-red)]" : undefined}>{s.text}</span>
            {/* Separator trails its segment, so a wrapped line never starts with one. */}
            {i < segments.length - 1 && <span className="text-[var(--tg-muted)]">·</span>}
          </motion.span>
        ))}
      </p>

      <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-[#E4EAF2]">
        {bar.map((b) => (
          <motion.span
            key={b.key}
            className="h-full"
            style={{ backgroundColor: b.color }}
            initial={false}
            animate={{ width: `${(b.value / limit) * 100}%` }}
            transition={{ duration: 0.5 }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="tabular text-[13px] leading-snug text-[var(--tg-muted)]">
          After these, {money(t.budgetUsed)} of {money(limit)} used today.
        </p>
        <button
          type="button"
          onClick={onReceipt}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border-[1.5px] border-[var(--tg-navy)]/20 px-2.5 text-[14px] font-semibold text-[var(--tg-navy)] transition-colors hover:bg-[var(--tg-navy)]/5"
        >
          <ReceiptText size={16} />
          View receipt
        </button>
      </div>
    </motion.footer>
  );
}

function SkeletonCard({ index }: { index: number }) {
  const reduce = useReducedMotion();
  return (
    <div className="relative h-[150px] overflow-hidden rounded-2xl bg-white shadow-[0_4px_16px_rgba(18,33,58,0.05)]" aria-hidden>
      <div className="absolute left-4 top-4 h-10 w-10 rounded-xl bg-[#EEF2F8]" />
      <div className="absolute left-[68px] top-5 h-3.5 w-40 rounded bg-[#EEF2F8]" />
      <div className="absolute left-[68px] top-11 h-3 w-24 rounded bg-[#EEF2F8]" />
      <div className="absolute bottom-12 left-4 h-6 w-28 rounded bg-[#EEF2F8]" />
      <div className="absolute inset-x-4 bottom-4 h-5 rounded bg-[#EEF2F8]" />
      {!reduce && (
        <motion.div
          className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/80 to-transparent"
          initial={{ x: "-100%" }}
          animate={{ x: "250%" }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut", delay: index * 0.15 }}
        />
      )}
    </div>
  );
}

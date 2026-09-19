import { motion, useReducedMotion } from "motion/react";
import { CheckCircle2, ChevronLeft } from "lucide-react";
import type { Basket, Line } from "../types";
import { discardedTexts, paytmText, proposedText, settledText } from "../lib/receipt";

const columns = [
  { label: "What the assistant proposed", dot: "bg-[var(--tg-cyan)]" },
  { label: "What the server settled", dot: "bg-[var(--tg-navy)]" },
  { label: "What Paytm reported", dot: "bg-[var(--tg-indigo)]" },
];

export function Receipt({ basket, onBack }: { basket: Basket; onBack: () => void }) {
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full flex-col px-4 pb-5 pt-14">
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 flex h-10 items-center gap-1 self-start rounded-full pl-1 pr-3 font-semibold text-[var(--tg-navy)] transition-colors hover:bg-black/5"
      >
        <ChevronLeft size={22} />
        Back to basket
      </button>

      <motion.section
        initial={reduce ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="receipt-paper relative mt-3 min-h-0 overflow-y-auto rounded-t-2xl bg-white px-3 pb-6 pt-4 shadow-[0_10px_30px_rgba(18,33,58,0.1)] [scrollbar-width:none]"
      >
        <div className="grid grid-cols-3 gap-2.5 border-b-2 border-[var(--tg-ink)] pb-2.5">
          {columns.map((c) => (
            <p key={c.label} className="text-[12px] font-semibold leading-tight text-[var(--tg-muted)]">
              <span className={`mb-1.5 block h-1.5 w-6 rounded-full ${c.dot}`} />
              {c.label}
            </p>
          ))}
        </div>

        {basket.lines.map((line, i) => (
          <motion.div
            key={line.id}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.12, duration: 0.3 }}
          >
            <ReceiptRow line={line} />
          </motion.div>
        ))}
      </motion.section>

      <p className="mt-4 text-center text-[13px] text-[var(--tg-muted)]">Synthetic store. Paytm simulator.</p>
    </div>
  );
}

function ReceiptRow({ line }: { line: Line }) {
  const stopped = line.outcome === "STOPPED";
  const paid = line.outcome === "PAID";

  return (
    <div className="grid grid-cols-3 gap-2.5 border-b border-dashed border-[#D5DDE8] py-3 text-[13px] leading-snug last:border-b-0">
      <div className="min-w-0 break-words">
        <p>{proposedText(line)}</p>
        {discardedTexts(line).map((text) => (
          <p key={text} className="mt-1 font-medium text-[var(--tg-red)] line-through decoration-2">
            {text}
          </p>
        ))}
      </div>

      <p className={`min-w-0 break-words ${stopped ? "font-semibold text-[var(--tg-red)]" : "text-[var(--tg-ink)]"}`}>
        {settledText(line)}
      </p>

      <p
        className={`tabular min-w-0 break-words ${
          paid ? "font-semibold text-[var(--tg-green)]" : stopped ? "font-medium text-[var(--tg-red)]" : "text-[var(--tg-muted)]"
        }`}
      >
        {paid && <CheckCircle2 size={14} className="-mt-0.5 mr-1 inline" />}
        {paytmText(line)}
      </p>
    </div>
  );
}

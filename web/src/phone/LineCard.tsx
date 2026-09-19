import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { AlertTriangle, FileWarning, RotateCw } from "lucide-react";
import type { Line, Outcome } from "../types";
import { money } from "../lib/money";
import { itemIcon } from "../lib/items";
import { Pill } from "../ui/Pill";
import { supplierParts } from "../lib/supplier";

const pill = {
  READY: { tone: "green", label: "Ready" },
  NEEDS_APPROVAL: { tone: "amber", label: "Needs you" },
  STOPPED: { tone: "red", label: "Stopped" },
} as const;

const edge: Partial<Record<Outcome, string>> = {
  READY: "var(--tg-green)",
  NEEDS_APPROVAL: "var(--tg-amber)",
  STOPPED: "var(--tg-red)",
  PAYING: "var(--tg-indigo)",
  CONFIRMING: "var(--tg-indigo)",
  PAID: "var(--tg-green)",
  PAYMENT_FAILED: "#B7C2D1",
};

// Status is carried by the left edge and the pill. Only a stopped card is tinted: it has no
// price or button, and the tint is what makes it read as refused at a glance.
const surface: Partial<Record<Outcome, string>> = {
  STOPPED: "#FDF3F2",
};


function OutcomePill({ line, reduce }: { line: Line; reduce: boolean | null }) {
  const p = pill[line.outcome as keyof typeof pill];
  if (!p) return null;
  return (
    <motion.span
      key={line.outcome}
      className="inline-block"
      initial={reduce ? false : { scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <Pill tone={p.tone}>{p.label}</Pill>
    </motion.span>
  );
}

interface Props {
  line: Line;
  pending?: boolean;
  /** Ready from a verified supplier: pays itself, so it shows progress instead of a Pay button. */
  autoPay?: boolean;
  /** Supplier whose listing carried the instruction behind this line, if any. */
  injectedFrom?: string;
  onPay?: (line: Line) => void;
  onReview?: (line: Line) => void;
  onCheckAgain?: (line: Line) => void;
  onTryAgain?: (line: Line) => void;
}

export function LineCard({ line, pending, autoPay, injectedFrom, onPay, onReview, onCheckAgain, onTryAgain }: Props) {
  const reduce = useReducedMotion();
  const Icon = itemIcon(line.sku);
  const stopped = line.outcome === "STOPPED";
  const showReason = line.outcome === "READY" || line.outcome === "NEEDS_APPROVAL" || stopped;

  return (
    <motion.article
      className={`relative overflow-hidden rounded-2xl p-3.5 pl-[18px] shadow-[0_4px_16px_rgba(18,33,58,0.07)] ${
        stopped ? "ring-1 ring-[var(--tg-red)]/25" : ""
      }`}
      initial={false}
      animate={{
        backgroundColor: surface[line.outcome] ?? "#FFFFFF",
        opacity: line.outcome === "PAYING" ? 0.6 : 1,
      }}
      transition={{ duration: 0.3 }}
    >
      <motion.span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        initial={false}
        animate={{ backgroundColor: edge[line.outcome] ?? "#E4EAF2" }}
        transition={{ duration: 0.3 }}
      />

      <div className="flex items-start gap-3">
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
            stopped ? "bg-[var(--tg-red)]/10 text-[var(--tg-red)]" : "bg-[#EEF2F8] text-[var(--tg-navy)]"
          }`}
        >
          <Icon size={18} strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">
            {line.name} x {line.quantity}
          </p>
          {line.derived && <Supplier supplier={line.derived.supplier} />}
        </div>
        {!line.derived && <OutcomePill line={line} reduce={reduce} />}
      </div>

      {line.derived && (
        <div className="mt-2.5 flex items-center gap-2">
          <span className="tabular text-[28px] font-semibold leading-none tracking-tight">
            {money(line.derived.amount_minor)}
          </span>
          <motion.span
            initial={reduce ? false : { scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.2, delay: 0.15 }}
            className="rounded-md bg-[var(--tg-navy)] px-1.5 py-0.5 text-[12px] font-semibold text-white"
          >
            priced by server
          </motion.span>
          <span className="ml-auto">
            <OutcomePill line={line} reduce={reduce} />
          </span>
        </div>
      )}

      {showReason && line.reason_text && (
        <p className={`mt-1.5 text-[14px] leading-snug ${stopped ? "font-medium text-[var(--tg-red)]" : "text-[var(--tg-muted)]"}`}>
          {line.reason_text}
        </p>
      )}

      {stopped && injectedFrom && (
        <motion.p
          className="mt-2 flex items-start gap-1.5 rounded-lg bg-[var(--tg-red)]/8 px-2.5 py-1.5 text-[13px] leading-snug text-[#9B2F26]"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <FileWarning size={15} className="mt-px shrink-0" />
          <span>The instruction came from {injectedFrom}'s product listing.</span>
        </motion.p>
      )}

      {line.outcome === "READY" && autoPay && (
        <StatusRow>
          <ConfirmRing />
          <span className="leading-snug">Verified supplier. Paying automatically...</span>
        </StatusRow>
      )}

      {line.outcome === "READY" && !autoPay && line.derived && onPay && (
        <motion.button
          type="button"
          onClick={() => onPay(line)}
          whileTap={reduce ? undefined : { scale: 0.98 }}
          className="mt-2.5 h-10 w-full rounded-xl bg-[var(--tg-indigo)] text-[15px] font-semibold text-white shadow-[0_6px_16px_rgba(91,108,255,0.3)] transition-[filter] hover:brightness-110"
        >
          Pay {money(line.derived.amount_minor)} with Paytm
        </motion.button>
      )}

      {line.outcome === "NEEDS_APPROVAL" && onReview && (
        <motion.button
          type="button"
          onClick={() => onReview(line)}
          whileTap={reduce ? undefined : { scale: 0.98 }}
          className="mt-2.5 h-10 w-full rounded-xl border-[1.5px] border-[var(--tg-amber)] bg-[var(--tg-amber)]/8 text-[15px] font-semibold text-[#A86A0C] transition-colors hover:bg-[var(--tg-amber)]/15"
        >
          Review
        </motion.button>
      )}

      {line.outcome === "PAYING" && (
        <StatusRow>
          <span className="text-[var(--tg-muted)]">Opening Paytm...</span>
        </StatusRow>
      )}

      {line.outcome === "CONFIRMING" && (
        <>
          <StatusRow>
            <ConfirmRing />
            <span className="leading-snug">
              {pending
                ? "Paytm hasn't confirmed yet, so we haven't marked this paid."
                : autoPay
                  ? "Verified supplier. Paying automatically..."
                  : "Confirming with Paytm..."}
            </span>
          </StatusRow>
          {pending && onCheckAgain && (
            <button
              type="button"
              onClick={() => onCheckAgain(line)}
              className="mt-2.5 flex h-10 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-[var(--tg-indigo)]/40 text-[15px] font-semibold text-[var(--tg-indigo)] transition-colors hover:bg-[var(--tg-indigo)]/5"
            >
              <RotateCw size={16} />
              Check again
            </button>
          )}
        </>
      )}

      {line.outcome === "PAID" && (
        <StatusRow>
          <PaidCheck />
          <span className="font-semibold text-[var(--tg-green)]">
            {autoPay ? "Paid automatically · confirmed by Paytm" : "Paid · confirmed by Paytm"}
          </span>
        </StatusRow>
      )}

      {line.outcome === "PAYMENT_FAILED" && (
        <>
          <StatusRow>
            <span>Payment failed. Nothing was charged.</span>
          </StatusRow>
          {onTryAgain && (
            <button
              type="button"
              onClick={() => onTryAgain(line)}
              className="mt-2.5 h-10 w-full rounded-xl border-[1.5px] border-[#D5DDE8] text-[15px] font-semibold text-[var(--tg-ink)] transition-colors hover:bg-black/[0.03]"
            >
              Try again
            </button>
          )}
        </>
      )}

      {line.outcome === "HELD_FOR_REVIEW" && (
        <StatusRow>
          <span>Held for review by the server.</span>
        </StatusRow>
      )}
    </motion.article>
  );
}

function Supplier({ supplier }: { supplier: string }) {
  const { name, unverified } = supplierParts(supplier);
  return (
    <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-[var(--tg-muted)]">
      <span className="truncate">{name}</span>
      {unverified && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-[var(--tg-amber)]/15 px-1.5 py-px text-[11px] font-semibold text-[#A86A0C]">
          <AlertTriangle size={11} strokeWidth={2.5} />
          unverified
        </span>
      )}
    </p>
  );
}

function StatusRow({ children }: { children: ReactNode }) {
  return <div className="mt-2.5 flex min-h-10 items-center gap-2.5 text-[14px]">{children}</div>;
}

/** Slow pulsing ring, cyan to indigo, 1.6s loop (section 5). */
function ConfirmRing() {
  const reduce = useReducedMotion();
  return (
    <span className="relative grid h-7 w-7 shrink-0 place-items-center">
      {!reduce && (
        <motion.span
          className="absolute inset-0 rounded-full border-2"
          animate={{
            borderColor: ["var(--tg-cyan)", "var(--tg-indigo)", "var(--tg-cyan)"],
            scale: [0.85, 1.1, 0.85],
            opacity: [1, 0.6, 1],
          }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      <span className="h-2.5 w-2.5 rounded-full bg-[var(--tg-indigo)]" />
    </span>
  );
}

/** A check mark that draws itself (section 5, 400ms). */
function PaidCheck() {
  const reduce = useReducedMotion();
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" className="shrink-0" aria-hidden>
      <circle cx="14" cy="14" r="14" fill="var(--tg-green)" />
      <motion.path
        d="M8 14.5l4 4 8-9"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      />
    </svg>
  );
}

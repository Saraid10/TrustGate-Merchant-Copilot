import { motion, useReducedMotion } from "motion/react";
import { Clock, Lock, X, XCircle } from "lucide-react";
import type { Line, Rail } from "../types";
import { money } from "../lib/money";
import { Backdrop } from "../ui/Backdrop";
import { useEscape } from "../lib/useEscape";

export type PayChoice = "PAY" | "PENDING" | "FAIL" | "CANCEL";

interface Props {
  line: Line;
  /** The real checkout page (the backend's simulator or Paytm). Absent on sample data. */
  checkout?: string;
  rail?: Rail;
  onChoose: (choice: PayChoice) => void;
}

/**
 * The checkout. On the real backend it shows the server's checkout page in a frame; the
 * outcome comes back through Paytm's callback, not from buttons here. On sample data it shows
 * its own Pay / Leave pending / Fail. The title says SIMULATED whenever the rail is simulated.
 */
export function PayModal({ line, checkout, rail = "SIMULATED", onChoose }: Props) {
  const reduce = useReducedMotion();
  const amount = line.derived?.amount_minor ?? 0;
  useEscape(() => onChoose("CANCEL"));

  return (
    <>
      <Backdrop onClick={() => onChoose("CANCEL")} />
      <motion.section
        role="dialog"
        aria-modal
        aria-labelledby="checkout-title"
        className="absolute inset-x-4 top-1/2 z-50 overflow-hidden rounded-3xl bg-white shadow-[0_24px_60px_rgba(11,21,38,0.35)]"
        initial={reduce ? { opacity: 0, y: "-50%" } : { opacity: 0, y: "-46%", scale: 0.96 }}
        animate={{ opacity: 1, y: "-50%", scale: 1 }}
        exit={reduce ? { opacity: 0, y: "-50%" } : { opacity: 0, y: "-46%", scale: 0.96 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      >
        <header className="flex items-center gap-2.5 bg-[var(--tg-indigo)] px-5 py-4 text-white">
          <Lock size={17} strokeWidth={2.4} />
          <h2 id="checkout-title" className="flex-1 text-[16px] font-semibold">
            {rail === "SIMULATED" ? "Paytm test checkout (SIMULATED)" : "Paytm checkout (staging)"}
          </h2>
          <button
            type="button"
            onClick={() => onChoose("CANCEL")}
            aria-label="Cancel"
            className="-mr-1.5 grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-white/15"
          >
            <X size={18} strokeWidth={2.4} />
          </button>
        </header>

        {checkout ? (
          <iframe
            src={checkout}
            title="Paytm checkout"
            className="block h-[520px] w-full border-0 bg-white"
          />
        ) : (
          <div className="px-5 pb-5 pt-6 text-center">
            <p className="text-[14px] text-[var(--tg-muted)]">{line.derived?.supplier}</p>
            <p className="tabular mt-1 text-[40px] font-semibold leading-none tracking-tight">{money(amount)}</p>
            <p className="mt-2 text-[14px] text-[var(--tg-ink)]">
              {line.name} x {line.quantity}
            </p>

            <div className="mt-6 grid gap-2.5">
              <motion.button
                type="button"
                onClick={() => onChoose("PAY")}
                whileTap={reduce ? undefined : { scale: 0.98 }}
                className="h-12 rounded-2xl bg-[var(--tg-indigo)] text-[16px] font-semibold text-white shadow-[0_8px_20px_rgba(91,108,255,0.35)]"
              >
                Pay
              </motion.button>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => onChoose("PENDING")}
                  className="flex h-11 items-center justify-center gap-1.5 rounded-2xl border-[1.5px] border-[#DCE3EC] text-[15px] font-semibold text-[var(--tg-ink)] transition-colors hover:bg-black/[0.03]"
                >
                  <Clock size={16} />
                  Leave pending
                </button>
                <button
                  type="button"
                  onClick={() => onChoose("FAIL")}
                  className="flex h-11 items-center justify-center gap-1.5 rounded-2xl border-[1.5px] border-[#DCE3EC] text-[15px] font-semibold text-[var(--tg-ink)] transition-colors hover:bg-black/[0.03]"
                >
                  <XCircle size={16} />
                  Fail
                </button>
              </div>
            </div>
          </div>
        )}
      </motion.section>
    </>
  );
}

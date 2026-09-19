import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, ShieldX } from "lucide-react";
import { money } from "../lib/money";
import { useEscape } from "../lib/useEscape";

interface Props {
  blocked: number;
  payee: string | null;
  onEndings: () => void;
  onDismiss: () => void;
}

/** The payoff moment: shown over the Live tab once a stopped line's money is counted. */
export function StopBanner({ blocked, payee, onEndings, onDismiss }: Props) {
  const reduce = useReducedMotion();
  useEscape(onDismiss);

  return (
    <motion.div
      className="absolute inset-0 z-20 grid place-items-center bg-[#020B1C]/75 p-8 backdrop-blur-[2px]"
      onClick={onDismiss}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <motion.div
        role="status"
        className="w-full max-w-[560px] rounded-2xl border-2 border-[var(--tg-red)] bg-[var(--tg-stage)] p-7 text-center shadow-[0_0_80px_rgba(207,68,57,0.45)]"
        onClick={(e) => e.stopPropagation()}
        initial={reduce ? false : { scale: 0.9, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
      >
        <ShieldX size={40} className="mx-auto text-[var(--tg-red)]" />
        <p className="mt-3 text-[44px] font-semibold leading-none tracking-tight text-white">
          {money(blocked)} did not move
        </p>
        {payee && (
          <p className="mt-3 text-[16px] leading-snug text-white/75">
            The assistant was told to pay <span className="font-semibold text-[#FF9A90]">{payee}</span>. Nothing was sent to Paytm.
          </p>
        )}
        <button
          type="button"
          onClick={onEndings}
          className="mx-auto mt-6 flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[15px] font-semibold text-[var(--tg-stage)] transition-transform hover:scale-[1.03]"
        >
          See both endings
          <ArrowRight size={17} />
        </button>
      </motion.div>
    </motion.div>
  );
}

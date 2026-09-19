import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ShieldCheck } from "lucide-react";
import type { Line, Store } from "../types";
import { money } from "../lib/money";
import { Backdrop } from "../ui/Backdrop";
import { useEscape } from "../lib/useEscape";

interface Props {
  line: Line;
  store: Store;
  onApprove: () => Promise<void>;
  onClose: () => void;
}

/** "Sunflower oil, 15 L tin" becomes "sunflower oil" for the title and "15 L tin" for the detail. */
function splitName(name: string | null) {
  const [product, size] = (name ?? "").split(", ");
  return { product: product.charAt(0).toLowerCase() + product.slice(1), size: size ?? "" };
}

export function ApprovalSheet({ line, store, onApprove, onClose }: Props) {
  const reduce = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const { product, size } = splitName(line.name);
  const amount = line.derived?.amount_minor ?? 0;
  useEscape(busy ? undefined : onClose);

  async function approve() {
    setBusy(true);
    await onApprove();
  }

  return (
    <>
      <Backdrop onClick={busy ? undefined : onClose} />
      <motion.section
        role="dialog"
        aria-modal
        aria-labelledby="approve-title"
        className="absolute inset-x-0 bottom-0 z-50 rounded-t-[28px] bg-white px-6 pb-8 pt-3 shadow-[0_-12px_40px_rgba(18,33,58,0.18)]"
        initial={reduce ? { opacity: 0 } : { y: "100%" }}
        animate={reduce ? { opacity: 1 } : { y: 0 }}
        exit={reduce ? { opacity: 0 } : { y: "100%" }}
        transition={{ type: "tween", duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="mx-auto h-1.5 w-10 rounded-full bg-[#D9E0EA]" />

        <span className="mt-5 grid h-12 w-12 place-items-center rounded-2xl bg-[var(--tg-amber)]/12 text-[#A86A0C]">
          <ShieldCheck size={26} strokeWidth={2} />
        </span>

        <h2 id="approve-title" className="mt-4 text-[22px] font-semibold tracking-tight">
          Approve {product}?
        </h2>
        <p className="tabular mt-1.5 text-[var(--tg-ink)]">
          {size} from {line.derived?.supplier} · {money(amount)}
        </p>
        <p className="mt-3 rounded-xl bg-[var(--tg-amber)]/10 px-3.5 py-2.5 text-[14px] text-[#8A5708]">
          Above your auto-approve limit of {money(store.budget.approval_above_minor)}.
        </p>
        <p className="mt-3 text-[14px] text-[var(--tg-muted)]">
          Approving as the store owner. The assistant cannot approve for you.
        </p>

        <div className="mt-6 grid gap-2.5">
          <motion.button
            type="button"
            onClick={approve}
            disabled={busy}
            whileTap={reduce || busy ? undefined : { scale: 0.98 }}
            className="h-12 rounded-2xl bg-[var(--tg-green)] text-[16px] font-semibold text-white shadow-[0_8px_20px_rgba(22,163,106,0.3)] disabled:opacity-70"
          >
            Approve
          </motion.button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-12 rounded-2xl text-[16px] font-semibold text-[var(--tg-muted)] transition-colors hover:bg-black/[0.03]"
          >
            Not now
          </button>
        </div>
      </motion.section>
    </>
  );
}

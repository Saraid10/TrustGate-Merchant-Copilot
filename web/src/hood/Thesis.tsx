import { motion, useReducedMotion } from "motion/react";

const steps = [
  {
    actor: "ASSISTANT",
    chip: "bg-[var(--tg-cyan)] text-[var(--tg-stage)]",
    text: "Proposes what to buy and how many. Nothing else.",
  },
  {
    actor: "SERVER",
    chip: "bg-white text-[var(--tg-navy)]",
    text: "Prices it from the catalogue and picks who gets paid. Any amount or payee from the assistant is thrown away.",
  },
  {
    actor: "OWNER · PAYTM",
    chip: "bg-[var(--tg-indigo)] text-white",
    text: "Anything over the owner's limit waits for them. Paytm must confirm before it counts as paid.",
  },
];

/** What the Live tab shows before anything has happened: the product's reason to exist. */
export function Thesis() {
  const reduce = useReducedMotion();

  return (
    <div className="flex flex-1 flex-col justify-center px-2">
      <motion.p
        className="max-w-[640px] text-[26px] font-semibold leading-tight tracking-tight text-white"
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        AI agents can be tricked into paying.{" "}
        <span className="text-[var(--tg-cyan)]">This one can't choose who gets paid.</span>
      </motion.p>

      <ol className="mt-8 grid grid-cols-3 gap-4">
        {steps.map((s, i) => (
          <motion.li
            key={s.actor}
            className="relative rounded-xl border border-[var(--tg-line)] bg-[var(--tg-stage)] p-4"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + i * 0.12, duration: 0.3 }}
          >
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-[13px] font-semibold text-white/80">
                {i + 1}
              </span>
              <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[12px] font-bold tracking-wider ${s.chip}`}>{s.actor}</span>
            </div>
            <p className="mt-3 text-[16px] leading-snug text-white/85">{s.text}</p>
          </motion.li>
        ))}
      </ol>

      <motion.p
        className="mt-6 text-[15px] text-white/55"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
      >
        Tap "Ask Copilot to restock" on the phone to watch it happen.
      </motion.p>
    </div>
  );
}

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Ban, RotateCcw, ShieldCheck, Zap } from "lucide-react";
import data from "../fixtures/two-endings.json";
import { money } from "../lib/money";
import { Counter } from "../ui/Counter";

const KEPT = new Set(["sku", "quantity", "purpose"]);

/** The same malicious model output, fed to an ordinary tool and to the gate. */
export function TwoEndings() {
  const [run, setRun] = useState(0);
  return <Endings key={run} onReplay={() => setRun((r) => r + 1)} />;
}

function Endings({ onReplay }: { onReplay: () => void }) {
  const reduce = useReducedMotion();
  const raw = Object.entries(data.raw_model_output);
  const at = (s: number) => (reduce ? 0 : s);

  return (
    <div className="flex h-full flex-col justify-center">
      <motion.div
        className="mx-auto w-full max-w-[640px] rounded-xl border border-[var(--tg-cyan)]/40 bg-[var(--tg-stage)] px-5 py-3 font-mono text-[15px] leading-[1.65] text-white/85 shadow-[0_0_30px_rgba(0,186,242,0.12)]"
        initial={reduce ? false : { opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <span className="mb-1 inline-block rounded bg-[var(--tg-cyan)]/15 px-1.5 py-0.5 font-sans text-[12px] font-bold tracking-wider text-[var(--tg-cyan)]">
          ASSISTANT
        </span>
        <div className="whitespace-pre">
          {"{ "}
          {raw.map(([k, v], i) => (
            <span key={k} className={KEPT.has(k) ? "" : "text-[#FF9A90]"}>
              "{k}": {JSON.stringify(v)}
              {i < raw.length - 1 ? ", " : ""}
              {i === 2 ? "\n  " : ""}
            </span>
          ))}
          {" }"}
        </div>
      </motion.div>

      <svg className="mx-auto h-10 w-[60%] shrink-0" viewBox="0 0 300 40" preserveAspectRatio="none" aria-hidden>
        <motion.path
          d="M150 0 C150 22, 20 18, 20 40" fill="none" stroke="var(--tg-red)" strokeWidth="2" strokeDasharray="5 4"
          initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: at(0.3), duration: 0.4 }}
        />
        <motion.path
          d="M150 0 C150 22, 280 18, 280 40" fill="none" stroke="var(--tg-green)" strokeWidth="2" strokeDasharray="5 4"
          initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: at(0.3), duration: 0.4 }}
        />
      </svg>

      <div className="grid grid-cols-2 gap-5">
        <motion.article
          className="flex flex-col rounded-2xl border-2 border-[var(--tg-red)] bg-[var(--tg-red)]/[0.08] p-6"
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: at(0.6), duration: 0.35 }}
        >
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--tg-red)]/20 text-[#FF9A90]">
              <Zap size={19} />
            </span>
            <h3 className="text-[18px] font-semibold text-white">An ordinary payment tool</h3>
          </div>
          <p className="mt-6 text-[16px] text-white/85">
            <span className="block text-[40px] font-semibold leading-none tracking-tight text-[#FF9A90]">
              <DelayedCounter value={data.ordinary_tool.paid_minor} delay={at(0.9)} />
            </span>
            <span className="mt-2 block">paid to {data.ordinary_tool.payee}</span>
          </p>
          <p className="mt-4 text-[15px] font-semibold text-white">
            {data.ordinary_tool.payments_made} payment made
          </p>
          <p className="mt-auto pt-6 text-[14px] text-white/55">Isolated simulation. No money exists here.</p>
        </motion.article>

        <motion.article
          className="flex flex-col rounded-2xl border-2 border-[var(--tg-green)] bg-[var(--tg-green)]/[0.08] p-6"
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: at(0.75), duration: 0.35 }}
        >
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--tg-green)]/20 text-[#5FE0A6]">
              <ShieldCheck size={19} />
            </span>
            <h3 className="text-[18px] font-semibold text-white">Through the gate</h3>
          </div>
          <motion.p
            className="mt-6 inline-flex items-center gap-2 self-start rounded-lg border-2 border-[var(--tg-red)] px-3 py-1 text-[28px] font-bold leading-none text-[#FF9A90]"
            initial={reduce ? false : { scale: 1.6, opacity: 0, rotate: -8 }}
            animate={{ scale: 1, opacity: 1, rotate: -3 }}
            transition={{ delay: at(1.1), duration: 0.25, ease: "easeOut" }}
          >
            <Ban size={24} />
            Stopped
          </motion.p>
          <p className="mt-3 text-[15px] text-white/75">{data.through_gate.reason_text}</p>
          <div className="mt-4 flex gap-6 text-[16px] font-semibold text-white">
            <span>{data.through_gate.paytm_orders} Paytm orders</span>
            <span>{money(data.through_gate.moved_minor)} moved</span>
          </div>
        </motion.article>
      </div>

      <button
        type="button"
        onClick={onReplay}
        className="mx-auto mt-6 flex items-center gap-2 rounded-full border border-white/20 px-5 py-2 text-[15px] font-medium text-white/85 transition-colors hover:bg-white/10"
      >
        <RotateCcw size={16} />
        Run both again
      </button>
    </div>
  );
}

function DelayedCounter({ value, delay }: { value: number; delay: number }) {
  const [shown, setShown] = useState(delay === 0 ? value : 0);
  useEffect(() => {
    const t = setTimeout(() => setShown(value), delay * 1000);
    return () => clearTimeout(t);
  }, [value, delay]);
  return <Counter value={shown} format={money} />;
}
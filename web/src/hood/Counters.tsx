import { motion, useReducedMotion } from "motion/react";
import { money } from "../lib/money";
import { Counter } from "../ui/Counter";

interface Props {
  blocked: number;
  decisions: number;
}

/**
 * One number that matters. "Money that did not move" only appears once something has actually
 * been stopped; until then a slim line counts the owner's decisions.
 */
export function Counters({ blocked, decisions }: Props) {
  const reduce = useReducedMotion();
  const stopped = blocked > 0;

  const decisionTile = (
    <div className={`rounded-xl border border-[var(--tg-line)] bg-[var(--tg-stage)] ${stopped ? "px-4 py-3.5" : "flex items-center justify-between px-4 py-2.5"}`}>
      <p className="text-[15px] font-medium leading-tight text-white/65">Decisions asked of the owner</p>
      <p className={`font-semibold leading-none tracking-tight text-white ${stopped ? "mt-1.5 text-[34px]" : "text-[22px]"}`}>
        <Counter value={decisions} />
      </p>
    </div>
  );

  if (!stopped) return decisionTile;

  return (
    <div className="grid grid-cols-3 gap-3">
      <motion.div
        className="col-span-2 flex items-center justify-between rounded-xl border border-[var(--tg-red)] bg-[var(--tg-red)]/14 px-5 py-3.5 shadow-[0_0_32px_rgba(207,68,57,0.35)]"
        initial={reduce ? false : { opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35 }}
      >
        <p className="text-[17px] font-semibold text-white/85">Money that did not move</p>
        <p className="text-[40px] font-semibold leading-none tracking-tight text-white">
          <Counter value={blocked} format={money} />
        </p>
      </motion.div>
      {decisionTile}
    </div>
  );
}

import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, ChevronLeft } from "lucide-react";
import type { Store } from "../types";
import { AssistantAvatar } from "../ui/AssistantAvatar";

interface Props {
  store: Store;
  goal: string;
  showLiveOnly: boolean;
  onGoal: (goal: string) => void;
  onBack: () => void;
  onPlan: () => void;
}

export function Compose({ store, goal, showLiveOnly, onGoal, onBack, onPlan }: Props) {
  const reduce = useReducedMotion();
  const chips = store.suggestions.filter((s) => !s.needs_live || showLiveOnly);
  const empty = goal.trim() === "";

  return (
    <div className="flex h-full flex-col px-5 pb-6 pt-14">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="-ml-2 grid h-10 w-10 place-items-center rounded-full text-[var(--tg-ink)] transition-colors hover:bg-black/5"
      >
        <ChevronLeft size={24} />
      </button>

      <div className="mt-6 flex justify-center">
        <AssistantAvatar size={64} />
      </div>

      <div className="mt-6 rounded-3xl bg-white p-1.5 shadow-[0_6px_24px_rgba(18,33,58,0.08)] ring-1 ring-[#E4EAF2] transition-shadow focus-within:ring-2 focus-within:ring-[var(--tg-cyan)]/50">
        <textarea
          value={goal}
          onChange={(e) => onGoal(e.target.value)}
          placeholder="What do you need today?"
          rows={4}
          className="block w-full resize-none rounded-[20px] bg-transparent px-4 py-3 text-[17px] leading-snug outline-none placeholder:text-[#9AA8BB]"
        />
      </div>

      <ul className="mt-5 space-y-2.5">
        {chips.map((s, i) => (
          <motion.li
            key={s.text}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.12, duration: 0.3 }}
          >
            <motion.button
              type="button"
              onClick={() => onGoal(s.text)}
              whileTap={reduce ? undefined : { scale: 0.98 }}
              className={`w-full rounded-2xl border px-4 py-3 text-left leading-snug transition-colors ${
                goal === s.text
                  ? "border-[var(--tg-cyan)] bg-[var(--tg-cyan)]/8"
                  : "border-[#E1E7F0] bg-white hover:border-[var(--tg-cyan)]/60"
              }`}
            >
              {s.text}
            </motion.button>
          </motion.li>
        ))}
      </ul>

      <motion.button
        type="button"
        onClick={onPlan}
        disabled={empty}
        whileTap={reduce || empty ? undefined : { scale: 0.98 }}
        className="mt-auto flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--tg-navy)] text-[17px] font-semibold text-white shadow-[0_10px_24px_rgba(0,41,112,0.3)] transition-opacity disabled:opacity-35 disabled:shadow-none"
      >
        Plan my basket
        <ArrowRight size={19} />
      </motion.button>
    </div>
  );
}

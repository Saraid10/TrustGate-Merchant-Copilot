import { motion, useReducedMotion } from "motion/react";
import { RotateCcw } from "lucide-react";
import { Toggle } from "../ui/Toggle";
import { SHOW_SCORECARD } from "../config";

interface Props {
  compromised: boolean;
  baseMode: "LIVE" | "OFFLINE";
  onReset: () => void;
  onCompromise: () => void;
  onMode: () => void;
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="grid h-5 min-w-5 place-items-center rounded border border-white/25 bg-white/10 px-1 font-sans text-[11px] font-semibold text-white/80">
      {children}
    </kbd>
  );
}

/** Hidden by default; D shows it. Every control here also has a key. */
export function PresenterBar({ compromised, baseMode, onReset, onCompromise, onMode }: Props) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className="fixed bottom-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 whitespace-nowrap rounded-2xl border border-white/15 bg-[#020E22]/90 px-5 py-3 text-[14px] text-white shadow-[0_20px_60px_rgba(0,0,0,0.5)] backdrop-blur-md"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
      transition={{ duration: 0.2 }}
    >
      <button
        type="button"
        onClick={onReset}
        className="flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-white/10"
      >
        <RotateCcw size={15} />
        Reset
        <Key>R</Key>
      </button>

      <span className="h-6 w-px bg-white/15" />

      <label className="flex items-center gap-2.5">
        <Toggle on={compromised} onChange={onCompromise} label="Compromise the assistant" />
        <span className={compromised ? "font-semibold text-[#FF9A90]" : ""}>Compromise the assistant</span>
        <Key>C</Key>
      </label>

      <span className="h-6 w-px bg-white/15" />

      <button
        type="button"
        onClick={onMode}
        className="flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-white/10"
      >
        Assistant
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[12px] font-semibold">{baseMode}</span>
        <Key>L</Key>
      </button>

      <span className="h-6 w-px bg-white/15" />

      <span className="flex items-center gap-1.5 text-white/60">
        Tabs <Key>1</Key>
        <Key>2</Key>
        {SHOW_SCORECARD && <Key>3</Key>}
      </span>
      <span className="flex items-center gap-1.5 text-white/60">
        Hide <Key>D</Key>
      </span>
    </motion.div>
  );
}

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronRight } from "lucide-react";
import type { HoodEvent } from "../types";

const actorChip: Record<HoodEvent["actor"], string> = {
  ASSISTANT: "bg-[var(--tg-cyan)] text-[var(--tg-stage)]",
  SERVER: "bg-white text-[var(--tg-navy)]",
  OWNER: "bg-[#8C9AB0] text-[var(--tg-stage)]",
  PAYTM: "bg-[var(--tg-indigo)] text-white",
};

const toneDot: Record<HoodEvent["tone"], string> = {
  info: "bg-white/25",
  good: "bg-[var(--tg-green)]",
  warn: "bg-[var(--tg-amber)]",
  stop: "bg-[var(--tg-red)]",
};

export function LiveRecord({ events }: { events: HoodEvent[] }) {
  const reduce = useReducedMotion();
  const scroller = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [events.length, reduce]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <h3 className="flex items-center gap-2 text-[17px] font-semibold text-white">
        Live record
        {events.length > 0 && (
          <span className="relative flex h-2 w-2">
            {!reduce && <span className="absolute inset-0 animate-ping rounded-full bg-[var(--tg-green)] opacity-60" />}
            <span className="relative h-2 w-2 rounded-full bg-[var(--tg-green)]" />
          </span>
        )}
      </h3>

      <div ref={scroller} className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1 [mask-image:linear-gradient(to_bottom,transparent,black_28px)] [scrollbar-color:var(--tg-line)_transparent]">
        <ul className="space-y-1">
          <AnimatePresence initial={false}>
            {events.map((e, i) => {
              const key = `${e.id}-${i}`;
              const expanded = open === key;
              return (
                <motion.li
                  key={key}
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className={`rounded-lg ${e.tone === "stop" ? "bg-[var(--tg-red)]/12" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : key)}
                    aria-expanded={expanded}
                    className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/5"
                  >
                    <span className="tabular w-[72px] shrink-0 font-mono text-[14px] text-white/50">{e.at}</span>
                    <span
                      className={`w-[100px] shrink-0 rounded px-1.5 py-0.5 text-center text-[13px] font-bold tracking-wider ${actorChip[e.actor]}`}
                    >
                      {e.actor}
                    </span>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[e.tone]}`} />
                    <span className={`min-w-0 flex-1 text-[17px] leading-snug ${e.tone === "stop" ? "text-[#FF9A90]" : "text-white/90"}`}>
                      {e.title}
                    </span>
                    <ChevronRight
                      size={16}
                      className={`shrink-0 text-white/35 transition-transform ${expanded ? "rotate-90" : ""}`}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="mx-2.5 mb-2 overflow-hidden rounded-md bg-black/30 font-mono text-[15px] leading-relaxed text-[#9FE3FF]"
                      >
                        <pre className="p-3">{JSON.stringify(e.raw, null, 2)}</pre>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </div>
    </section>
  );
}

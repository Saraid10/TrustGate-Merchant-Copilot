import { motion, useReducedMotion } from "motion/react";
import { Sparkles } from "lucide-react";

/** The assistant is always cyan. `thinking` adds a slow breathing ring. */
export function AssistantAvatar({ size = 40, thinking = false }: { size?: number; thinking?: boolean }) {
  const reduce = useReducedMotion();

  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      {thinking && !reduce && (
        <motion.span
          className="absolute inset-0 rounded-full bg-[var(--tg-cyan)]"
          initial={{ opacity: 0.35, scale: 1 }}
          animate={{ opacity: 0, scale: 1.7 }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <span
        className="relative grid h-full w-full place-items-center rounded-full bg-[var(--tg-cyan)] text-white shadow-[0_6px_18px_rgba(0,186,242,0.35)]"
      >
        <Sparkles size={size * 0.48} strokeWidth={2.2} />
      </span>
    </span>
  );
}

import { useEffect } from "react";
import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";

/** A number that springs to its new value over about 500ms (section 5). */
export function Counter({ value, format = (n) => String(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
  const reduce = useReducedMotion();
  const spring = useSpring(value, { stiffness: 140, damping: 22, restDelta: 0.5 });
  const text = useTransform(spring, (n) => format(n));

  useEffect(() => {
    if (reduce) spring.jump(value);
    else spring.set(value);
  }, [value, reduce, spring]);

  return <motion.span className="tabular">{text}</motion.span>;
}

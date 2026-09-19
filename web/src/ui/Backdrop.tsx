import { motion } from "motion/react";

export function Backdrop({ onClick }: { onClick?: () => void }) {
  return (
    <motion.div
      aria-hidden
      onClick={onClick}
      className="absolute inset-0 z-40 bg-[#0B1526]/45 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    />
  );
}

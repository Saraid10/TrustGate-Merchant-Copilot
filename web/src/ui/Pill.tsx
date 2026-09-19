import type { ReactNode } from "react";

type Tone = "green" | "amber" | "red" | "muted";

const tones: Record<Tone, string> = {
  green: "bg-[var(--tg-green)]/12 text-[var(--tg-green)]",
  amber: "bg-[var(--tg-amber)]/15 text-[#A86A0C]",
  red: "bg-[var(--tg-red)]/12 text-[var(--tg-red)]",
  muted: "bg-[var(--tg-muted)]/12 text-[var(--tg-muted)]",
};

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

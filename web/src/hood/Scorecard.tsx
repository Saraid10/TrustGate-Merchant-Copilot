import { motion, useReducedMotion } from "motion/react";
import scorecard from "../fixtures/scorecard.json";

type ScorecardData = typeof scorecard;

/** Only ever shows numbers from the file. If there is no file, says so (section 7). */
export function Scorecard({ data = scorecard }: { data?: ScorecardData | null }) {
  const reduce = useReducedMotion();

  if (!data) {
    return <p className="text-[16px] text-[var(--tg-muted)]">Not run yet.</p>;
  }

  const { groups } = data;
  const bands = [
    { key: "routine", label: "routine", value: groups.routine, color: "var(--tg-green)" },
    { key: "needs_approval", label: "needs approval", value: groups.needs_approval, color: "var(--tg-amber)" },
    { key: "prohibited", label: "prohibited", value: groups.prohibited, color: "var(--tg-red)" },
  ];

  const tiles = [
    {
      label: "Safe completion",
      value: `${data.safe_task_completion.passed}/${data.safe_task_completion.of}`,
      caption: null,
    },
    {
      label: "False refusals",
      value: String(data.false_refusals.count),
      caption: `out of the ${data.false_refusals.of} requests that should have been allowed`,
    },
    {
      label: "Paytm orders from prohibited requests",
      value: String(data.paytm_orders_from_prohibited),
      caption: null,
    },
  ];

  return (
    <div>
      <h3 className="text-[22px] font-semibold text-white">
        {data.total_requests} scripted requests ·{" "}
        <span className="rounded-md bg-[var(--tg-green)]/15 px-2 py-0.5 text-[var(--tg-green)]">{data.label}</span>
      </h3>

      <div className="mt-5 flex h-3 overflow-hidden rounded-full">
        {bands.map((b, i) => (
          <motion.span
            key={b.key}
            style={{ backgroundColor: b.color }}
            initial={reduce ? false : { width: 0 }}
            animate={{ width: `${(b.value / data.total_requests) * 100}%` }}
            transition={{ delay: i * 0.12, duration: 0.5 }}
          />
        ))}
      </div>
      <p className="mt-2 flex gap-5 text-[14px] text-white/65">
        {bands.map((b) => (
          <span key={b.key} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.color }} />
            {b.value} {b.label}
          </span>
        ))}
      </p>

      <div className="mt-6 grid grid-cols-3 gap-4">
        {tiles.map((t, i) => (
          <motion.div
            key={t.label}
            className="rounded-2xl border border-[var(--tg-line)] bg-[var(--tg-stage)] p-5"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + i * 0.12, duration: 0.3 }}
          >
            <p className="text-[15px] font-medium text-white/65">{t.label}</p>
            <p className="tabular mt-2 text-[48px] font-semibold leading-none tracking-tight text-white">{t.value}</p>
            {t.caption && <p className="mt-2 text-[13px] leading-snug text-white/50">{t.caption}</p>}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

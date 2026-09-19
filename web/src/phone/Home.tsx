import { motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";
import type { Store } from "../types";
import { money } from "../lib/money";
import { itemIcon } from "../lib/items";
import { Pill } from "../ui/Pill";
import { AssistantAvatar } from "../ui/AssistantAvatar";

const today = new Intl.DateTimeFormat("en-IN", {
  weekday: "long", day: "numeric", month: "long",
}).format(new Date());

/** The brief says "Good morning"; the demo runs all day, so match the clock. */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

interface Props {
  store: Store | null;
  error: boolean;
  onRestock: () => void;
}

export function Home({ store, error, onRestock }: Props) {
  const reduce = useReducedMotion();
  const low = store?.stock.filter((row) => row.status !== "OK") ?? [];

  return (
    <div className="flex h-full flex-col px-5 pb-6 pt-16">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{greeting()},{" "}<span className="whitespace-nowrap">Nandi Kirana</span></h1>
          <p className="mt-0.5 text-[var(--tg-muted)]">{today}</p>
        </div>
        <StoreBadge />
      </header>

      {error ? (
        <p className="mt-8 rounded-2xl bg-white p-4 text-[var(--tg-red)] shadow-[0_2px_10px_rgba(18,33,58,0.06)]">
          Can't reach the store server. Nothing has been ordered.
        </p>
      ) : !store ? (
        <Skeleton />
      ) : (
        <>
          <Budget store={store} />

          <ul className="mt-5 space-y-2.5">
            {low.map((row, i) => {
              const Icon = itemIcon(row.sku);
              return (
                <motion.li
                  key={row.sku}
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.12, duration: 0.3 }}
                  className="relative flex items-center gap-3 overflow-hidden rounded-2xl bg-white px-3.5 py-3 shadow-[0_2px_10px_rgba(18,33,58,0.06)]"
                >
                  {!reduce && (
                    <motion.span
                      aria-hidden
                      className={`pointer-events-none absolute inset-0 ${
                        row.status === "OUT" ? "bg-[var(--tg-red)]" : "bg-[var(--tg-amber)]"
                      }`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: [0, 0.07, 0] }}
                      transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 2.8, delay: 1 + i * 0.25 }}
                    />
                  )}
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#EEF2F8] text-[var(--tg-navy)]">
                    <Icon size={22} strokeWidth={1.9} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{row.name}</p>
                    <p className="tabular text-[13px] text-[var(--tg-muted)]">
                      {row.on_hand} left · reorder at {row.reorder_at}
                    </p>
                  </div>
                  <Pill tone={row.status === "OUT" ? "red" : "amber"}>
                    {row.status === "OUT" ? "Out" : "Low"}
                  </Pill>
                </motion.li>
              );
            })}
          </ul>
        </>
      )}

      <motion.button
        type="button"
        onClick={onRestock}
        disabled={!store}
        whileHover={reduce ? undefined : { y: -1 }}
        whileTap={reduce ? undefined : { scale: 0.98 }}
        className="group mt-auto flex h-14 w-full items-center justify-between rounded-2xl bg-[var(--tg-navy)] pl-2 pr-5 text-[17px] font-semibold text-white shadow-[0_10px_24px_rgba(0,41,112,0.3)] disabled:opacity-40"
      >
        <span className="flex items-center gap-3">
          <AssistantAvatar size={40} />
          Ask Copilot to restock
        </span>
        <ArrowRight size={20} className="transition-transform group-hover:translate-x-0.5" />
      </motion.button>
    </div>
  );
}

function StoreBadge() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden className="shrink-0">
      <rect width="44" height="44" rx="14" fill="#fff" />
      <path d="M10 18h24l-2-6H12l-2 6Z" fill="var(--tg-navy)" />
      <path d="M10 18c0 2 1.6 3.4 4 3.4s4-1.4 4-3.4c0 2 1.6 3.4 4 3.4s4-1.4 4-3.4c0 2 1.6 3.4 4 3.4s4-1.4 4-3.4" stroke="var(--tg-navy)" strokeWidth="1.6" fill="#DCE5F2" />
      <path d="M13 22v10h18V22" stroke="var(--tg-navy)" strokeWidth="1.8" fill="none" />
      <rect x="19" y="25" width="6" height="7" rx="1" fill="var(--tg-navy)" />
    </svg>
  );
}

function Budget({ store }: { store: Store }) {
  const { daily_limit_minor, spent_today_minor, approval_above_minor } = store.budget;
  const used = Math.min(1, spent_today_minor / daily_limit_minor);
  const r = 26;
  const c = 2 * Math.PI * r;

  return (
    <section className="mt-6 flex items-center gap-4 rounded-2xl bg-white p-4 shadow-[0_2px_10px_rgba(18,33,58,0.06)]">
      <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0 -rotate-90" aria-hidden>
        <circle cx="32" cy="32" r={r} stroke="color-mix(in srgb, var(--tg-green) 18%, white)" strokeWidth="7" fill="none" />
        <motion.circle
          cx="32" cy="32" r={r} stroke="var(--tg-green)" strokeWidth="7" fill="none" strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - used) }}
          transition={{ duration: 0.8 }}
        />
      </svg>
      <div>
        <p className="tabular font-semibold">
          {money(spent_today_minor)} of {money(daily_limit_minor)} used today
        </p>
        <p className="mt-1 text-[13px] text-[var(--tg-muted)]">
          Auto-approve up to {money(approval_above_minor)} per item
        </p>
      </div>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="mt-6 space-y-3" aria-hidden>
      <div className="h-24 animate-pulse rounded-2xl bg-[#E4EAF2]" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[68px] animate-pulse rounded-2xl bg-[#E4EAF2]" />
      ))}
    </div>
  );
}

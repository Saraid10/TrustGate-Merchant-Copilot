import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, FileText, ShieldX, X } from "lucide-react";
import type { HoodEvent } from "../types";
import { money } from "../lib/money";
import { META_KEYS, listingForLine, type SourceListing } from "../lib/listing";

const KEPT = new Set(["sku", "quantity", "purpose"]);

// Section 5, "Passing the gate": each field crosses the gate line; forbidden ones then detach,
// turn red and are struck through. The whole sequence stays under a second.
const CROSS = 0.3;
const STAGGER = 0.07;

/** The last thing the assistant proposed, split at the gate into kept and discarded fields. */
export function TrustBoundary({ events }: { events: HoodEvent[] }) {
  const reduce = useReducedMotion();
  const last = [...events].reverse().find((e) => e.actor === "ASSISTANT");
  const entries = last ? Object.entries(last.raw).filter(([k]) => !META_KEYS.has(k)) : [];
  const kept = entries.filter(([k]) => KEPT.has(k));
  const discarded = entries.filter(([k]) => !KEPT.has(k));
  // Only events after this proposal: an earlier run may have used the same line id.
  const listing = last ? listingForLine(events.slice(events.lastIndexOf(last)), last.line_id) : null;
  const settle = reduce ? 0 : CROSS + (discarded.length + 1) * STAGGER;

  const amount = Number(last?.raw.amount_minor);
  const payee = last?.raw.merchant_id;

  return (
    <motion.section
      className="rounded-xl border bg-[var(--tg-stage)] p-4"
      initial={false}
      animate={{
        borderColor: discarded.length ? "rgba(207,68,57,0.7)" : "var(--tg-line)",
        boxShadow: discarded.length ? "0 0 36px rgba(207,68,57,0.25)" : "0 0 0 rgba(0,0,0,0)",
      }}
      transition={{ delay: settle, duration: 0.4 }}
    >
      <h3 className="flex items-center gap-2 text-[17px] font-semibold text-white">
        Trust boundary
        <span className="text-[13px] font-medium text-white/45">(last proposal)</span>
      </h3>

      {!last ? (
        <p className="mt-3 text-[15px] text-[var(--tg-muted)]">No proposal yet.</p>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={last.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {listing && <Listing listing={listing} />}

            <div className="relative mt-2.5 grid grid-cols-[auto_1fr] items-stretch gap-4">
              <div className="flex flex-col items-center gap-1.5 pt-0.5">
                <span className="rounded bg-[var(--tg-cyan)]/15 px-1.5 py-0.5 text-[12px] font-bold tracking-wider text-[var(--tg-cyan)]">
                  ASSISTANT
                </span>
                <span className="w-px flex-1 bg-gradient-to-b from-[var(--tg-cyan)]/60 to-white/60" />
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[12px] font-bold tracking-wider text-white">
                  GATE
                </span>
              </div>

              {/* Kept fields share one line; each discarded field gets its own, so it can detach. */}
              <div className="min-w-0 font-mono text-[15px] leading-[1.65] text-white/50">
                <motion.div
                  className="flex flex-wrap items-center gap-x-1.5"
                  initial={reduce ? false : { x: -36, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ duration: CROSS, ease: [0.22, 1, 0.36, 1] }}
                >
                  <span>{"{"}</span>
                  {kept.map(([key, value], i) => (
                    <span key={key} className="flex items-center gap-1 whitespace-pre text-white">
                      "{key}": {JSON.stringify(value)}
                      {i < kept.length - 1 || discarded.length ? "," : ""}
                      <Check size={15} strokeWidth={3} className="text-[var(--tg-green)]" />
                    </span>
                  ))}
                  {!discarded.length && <span>{"}"}</span>}
                </motion.div>
                {discarded.map(([key, value], i) => (
                  <Field
                    key={key}
                    name={key}
                    value={value}
                    last={i === discarded.length - 1}
                    delay={reduce ? 0 : (i + 1) * STAGGER}
                    settle={settle}
                  />
                ))}
              </div>
            </div>

            {discarded.length > 0 && (
              <motion.div
                className="mt-3 flex items-center gap-3 rounded-lg border border-[var(--tg-red)]/60 bg-[var(--tg-red)]/12 px-3.5 py-2"
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: settle + 0.25, duration: 0.3 }}
              >
                <ShieldX size={22} className="shrink-0 text-[var(--tg-red)]" />
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
                  {Number.isFinite(amount) && typeof payee === "string" && (
                    <p className="tabular text-[19px] font-semibold text-[#FF9A90] line-through decoration-2">
                      {money(amount)} to {payee}
                    </p>
                  )}
                  <p className="text-[14px] font-medium text-[var(--tg-red)]">discarded at the gate · never used</p>
                </div>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </motion.section>
  );
}

/** One discarded field: crosses the gate, then turns red, is struck through and shakes loose. */
function Field(props: { name: string; value: unknown; last: boolean; delay: number; settle: number }) {
  const { name, value, last, delay, settle } = props;
  const reduce = useReducedMotion();

  return (
    <motion.div
      className="flex items-center gap-2 pl-4"
      initial={reduce ? false : { x: -36, opacity: 0 }}
      animate={reduce ? { x: 0, opacity: 1 } : { x: [-36, 0, 0, -5, 5, -3, 0], opacity: [0, 1, 1, 1, 1, 1, 0.85] }}
      transition={reduce ? { duration: 0 } : { delay, duration: CROSS + 0.55, times: [0, 0.35, 0.55, 0.65, 0.75, 0.85, 1] }}
    >
      <motion.span
        className="relative whitespace-pre"
        initial={reduce ? false : { color: "#ffffff" }}
        animate={{ color: "var(--tg-red)" }}
        transition={{ delay: settle * 0.6 }}
      >
        "{name}": {JSON.stringify(value)}
        {last ? "" : ","}
        <motion.span
          aria-hidden
          className="absolute inset-x-0 top-1/2 h-[2px] origin-left bg-[var(--tg-red)]"
          initial={reduce ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: settle * 0.6, duration: 0.25 }}
        />
      </motion.span>
      <X size={16} strokeWidth={3} className="text-[var(--tg-red)]" />
      {last && <span>{"}"}</span>}
    </motion.div>
  );
}
/** The supplier text the assistant read, with the injected instruction marked. */
function Listing({ listing }: { listing: SourceListing }) {
  const reduce = useReducedMotion();
  const at = listing.injected ? listing.text.indexOf(listing.injected) : -1;
  const before = at >= 0 ? listing.text.slice(0, at) : listing.text;
  const after = at >= 0 ? listing.text.slice(at + listing.injected.length) : "";

  return (
    <motion.div
      className="mt-2.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2"
      initial={reduce ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-white/60">
        <FileText size={13} />
        Supplier listing the assistant read · {listing.supplier}
      </p>
      <p className="mt-1 text-[14px] leading-snug text-white/75">
        {before}
        {at >= 0 && (
          <motion.mark
            className="rounded bg-[var(--tg-red)]/20 px-0.5 text-[#FF9A90]"
            initial={reduce ? false : { backgroundColor: "rgba(207,68,57,0)" }}
            animate={{ backgroundColor: "rgba(207,68,57,0.22)" }}
            transition={{ delay: 0.2, duration: 0.4 }}
          >
            {listing.injected}
          </motion.mark>
        )}
        {after}
      </p>
    </motion.div>
  );
}

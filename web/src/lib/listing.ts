import type { HoodEvent } from "../types";

export interface SourceListing {
  supplier: string;
  text: string;
  injected: string;
}

/** The supplier listing an assistant proposal came from, when the event carries one. Optional:
    events without it (including the real backend's, until it sends one) simply show nothing. */
export function sourceListing(raw: Record<string, unknown>): SourceListing | null {
  const s = raw.source_listing as Partial<SourceListing> | undefined;
  if (!s || typeof s.text !== "string") return null;
  return { supplier: String(s.supplier ?? ""), text: s.text, injected: String(s.injected ?? "") };
}

/** The listing behind a line, from whichever event carries it. The server attaches it to the
    discard event, so it is the exact row the assistant read. */
export function listingForLine(events: HoodEvent[], lineId: string | null | undefined): SourceListing | null {
  if (!lineId) return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const s = e.line_id === lineId ? sourceListing(e.raw) : null;
    if (s) return s;
  }
  return null;
}

/** Line id → supplier whose listing carried an instruction for that line. */
export function injectedSuppliers(events: HoodEvent[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of events) {
    const s = e.line_id ? sourceListing(e.raw) : null;
    if (s && s.injected && e.line_id) out[e.line_id] = s.supplier;
  }
  return out;
}

/** Keys that are metadata about a proposal, not part of it. Never drawn as proposal fields. */
// Bookkeeping the panel needs but the gate never sees. Everything else in a proposal event
// is a field the assistant actually asked for, and is drawn as kept or discarded.
export const META_KEYS = new Set(["source_listing", "line_id", "position", "name"]);

import type { AssistantMode, Basket, HoodEvent, Line, Rail, Store } from "./types";

export type Screen = "HOME" | "COMPOSE" | "PLANNING" | "BASKET" | "RECEIPT";
export type Tab = "LIVE" | "ENDINGS" | "SCORECARD";
/** For PAY, `checkout` is the real checkout page to show; absent on sample data. */
export type Overlay = { kind: "APPROVE" | "PAY"; lineId: string; checkout?: string; rail?: Rail } | null;

export interface State {
  screen: Screen;
  overlay: Overlay;
  baseMode: "LIVE" | "OFFLINE";
  compromised: boolean;
  store: Store | null;
  storeError: boolean;
  goal: string;
  basket: Basket | null;
  events: HoodEvent[];
  /** Lines left pending at checkout. Still CONFIRMING; this only changes the wording (section 9). */
  pending: Record<string, boolean>;
  /** Lines paying themselves: Ready, verified supplier. Changes the card's wording only. */
  auto: Record<string, boolean>;
  tab: Tab;
  presenterOpen: boolean;
  /** Bumped by R so the phone remounts instantly instead of animating out. */
  resetCount: number;
  /** Index into `events` where the current plan started, so older events never reveal cards. */
  planFrom: number;
  /** Set if the server's decision events are late or missing: show every card anyway. */
  revealAll: boolean;
}

export const initialState: State = {
  screen: "HOME",
  overlay: null,
  baseMode: "LIVE",
  compromised: false,
  store: null,
  storeError: false,
  goal: "",
  basket: null,
  events: [],
  pending: {},
  auto: {},
  tab: "LIVE",
  presenterOpen: false,
  resetCount: 0,
  planFrom: 0,
  revealAll: false,
};

export type Action =
  | { type: "STORE_LOADED"; store: Store }
  | { type: "STORE_FAILED" }
  | { type: "GO"; screen: Screen }
  | { type: "SET_GOAL"; goal: string }
  | { type: "SET_BASKET"; basket: Basket }
  | { type: "UPDATE_LINE"; line: Line }
  | { type: "ADD_EVENT"; event: HoodEvent }
  | { type: "SET_PENDING"; lineId: string; pending: boolean }
  | { type: "SET_AUTO"; lineId: string }
  | { type: "OPEN_OVERLAY"; overlay: NonNullable<Overlay> }
  | { type: "CLOSE_OVERLAY" }
  | { type: "SET_TAB"; tab: Tab }
  /** The store as the server returned it after a mode change. The chip follows this only. */
  | { type: "MODE_FROM_SERVER"; store: Store }
  | { type: "TOGGLE_PRESENTER" }
  | { type: "REVEAL_ALL" }
  | { type: "RESET" };

/** Split the server's single mode into the chip's two parts: compromised, and the base mode
    underneath it that comes back when compromise is switched off. */
function modeFields(mode: AssistantMode, prev: State) {
  return {
    compromised: mode === "COMPROMISED",
    baseMode: mode === "COMPROMISED" ? prev.baseMode : mode,
  };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "STORE_LOADED":
    case "MODE_FROM_SERVER":
      return { ...state, ...modeFields(action.store.assistant_mode, state), store: action.store, storeError: false };
    case "STORE_FAILED":
      return { ...state, storeError: true };
    case "GO":
      if (action.screen === "PLANNING") {
        // A new plan: line ids repeat across baskets, so per-line flags start fresh.
        return { ...state, screen: action.screen, overlay: null, basket: null, planFrom: state.events.length, revealAll: false, pending: {}, auto: {} };
      }
      return { ...state, screen: action.screen, overlay: null };
    case "REVEAL_ALL":
      return { ...state, revealAll: true };
    case "SET_GOAL":
      return { ...state, goal: action.goal };
    case "SET_BASKET":
      return { ...state, basket: action.basket };
    case "UPDATE_LINE":
      if (!state.basket) return state;
      return {
        ...state,
        basket: {
          ...state.basket,
          lines: state.basket.lines.map((l) => (l.id === action.line.id ? action.line : l)),
        },
      };
    case "ADD_EVENT":
      return { ...state, events: [...state.events, action.event] };
    case "SET_AUTO":
      return { ...state, auto: { ...state.auto, [action.lineId]: true } };
    case "SET_PENDING":
      return { ...state, pending: { ...state.pending, [action.lineId]: action.pending } };
    case "OPEN_OVERLAY":
      return { ...state, overlay: action.overlay };
    case "CLOSE_OVERLAY":
      return { ...state, overlay: null };
    case "SET_TAB":
      return { ...state, tab: action.tab };
    case "TOGGLE_PRESENTER":
      return { ...state, presenterOpen: !state.presenterOpen };
    case "RESET":
      // Keeps the loaded store and the presenter's mode switches; clears the journey. The panel
      // goes back to Live, so the next judge starts on the explanation.
      return {
        ...initialState,
        store: state.store,
        storeError: state.storeError,
        baseMode: state.baseMode,
        compromised: state.compromised,
        presenterOpen: state.presenterOpen,
        resetCount: state.resetCount + 1,
      };
  }
}

/** Lines the server has already decided on in this plan: a SERVER event with a verdict. */
export function decidedLines(state: State): Set<string> {
  const out = new Set<string>();
  for (const e of state.events.slice(state.planFrom)) {
    if (e.actor === "SERVER" && e.line_id && e.tone !== "info") out.add(e.line_id);
  }
  return out;
}

/** The mode shown on the top bar chip and sent to createBasket. Compromise overrides. */
export function effectiveMode(state: State): AssistantMode {
  if (state.compromised) return "COMPROMISED";
  if (state.basket?.assistant.mode_used === "OFFLINE") return "OFFLINE";
  return state.baseMode;
}

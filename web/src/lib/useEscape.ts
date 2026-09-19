import { useEffect } from "react";

/** Calls `onEscape` when Escape is pressed, while the calling component is mounted. */
export function useEscape(onEscape: (() => void) | undefined) {
  useEffect(() => {
    if (!onEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape]);
}

"use client";

import { useEffect, useRef } from "react";

/**
 * Call `load` now and then again `ms` after it finishes, for as long as the component is mounted
 * and the tab is visible. The next call is never started while the last is still running, so a slow
 * gateway (the one in the browser, on a slow machine) is asked less often instead of being buried.
 * It starts over at once when `restartOn` changes.
 */
export function usePoll(load: () => Promise<unknown>, ms: number, restartOn: unknown = null): void {
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (stopped) return;
      if (typeof document === "undefined" || document.visibilityState === "visible") { try { await latest.current(); } catch { /* the next tick tries again */ } }
      if (!stopped) timer = setTimeout(tick, ms);
    };
    void tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [ms, restartOn]);
}

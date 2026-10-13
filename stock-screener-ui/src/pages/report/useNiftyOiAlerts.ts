import { useCallback, useEffect, useRef, useState } from "react";
import type { MarketAlert } from "@/components/notifications/MarketAlertCard";
import type { NiftyTapeRow } from "@/types/niftyReport";
import { burstToAlert, detectOiBursts } from "./niftyOiBursts";

/**
 * OI-burst alerts for the live Nifty report — plain React state, no store.
 *
 * Only minutes that arrive AFTER mount are announced: the first pass marks the
 * whole history as seen, so opening the page mid-session never replays the
 * morning. Switching context (mode/expiry/date) resets the seen-set.
 */

/** Transient toast lifetime; the inline trail keeps them longer. */
export const OI_ALERT_TTL_MS = 45_000;
/** Most-recent toasts shown at once. */
export const OI_ALERT_TOAST_MAX = 4;
/** Session trail length kept on the page. */
export const OI_ALERT_TRAIL_MAX = 20;

export interface NiftyOiAlerts {
  /** Every burst seen this session, newest first (persistent trail). */
  trail: MarketAlert[];
  /** The newest few, transient — the toast region. */
  toasts: MarketAlert[];
  dismissToast: (id: string) => void;
  clearTrail: () => void;
}

export function useNiftyOiAlerts(
  rows: NiftyTapeRow[],
  enabled: boolean,
  sessionKey: string,
): NiftyOiAlerts {
  const [trail, setTrail] = useState<MarketAlert[]>([]);
  const [toasts, setToasts] = useState<MarketAlert[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);
  const sessionRef = useRef(sessionKey);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Context switch → new session: forget what we've seen and start clean.
  useEffect(() => {
    if (sessionRef.current === sessionKey) return;
    sessionRef.current = sessionKey;
    seenRef.current = new Set();
    primedRef.current = false;
    for (const t of timersRef.current.values()) clearTimeout(t);
    timersRef.current.clear();
    setTrail([]);
    setToasts([]);
  }, [sessionKey]);

  useEffect(() => {
    if (!enabled) return;
    const bursts = detectOiBursts(rows);

    if (!primedRef.current) {
      // First pass is history, not news — mark it seen and stay silent.
      for (const b of bursts) seenRef.current.add(b.id);
      primedRef.current = true;
      return;
    }

    const fresh = bursts.filter((b) => !seenRef.current.has(b.id));
    if (fresh.length === 0) return;
    for (const b of fresh) seenRef.current.add(b.id);

    const mapped = fresh.slice(-OI_ALERT_TOAST_MAX).map(burstToAlert).reverse();
    setTrail((prev) => [...mapped, ...prev].slice(0, OI_ALERT_TRAIL_MAX));
    setToasts((prev) => [...mapped, ...prev].slice(0, OI_ALERT_TOAST_MAX));

    for (const a of mapped) {
      const existing = timersRef.current.get(a.id);
      if (existing) clearTimeout(existing);
      timersRef.current.set(
        a.id,
        setTimeout(() => {
          setToasts((prev) => prev.filter((x) => x.id !== a.id));
          timersRef.current.delete(a.id);
        }, OI_ALERT_TTL_MS),
      );
    }
  }, [rows, enabled]);

  useEffect(
    () => () => {
      for (const t of timersRef.current.values()) clearTimeout(t);
    },
    [],
  );

  const dismissToast = useCallback((id: string) => {
    const t = timersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const clearTrail = useCallback(() => setTrail([]), []);

  return { trail, toasts, dismissToast, clearTrail };
}

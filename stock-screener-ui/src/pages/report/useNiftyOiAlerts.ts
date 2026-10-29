import { useCallback, useEffect, useRef, useState } from "react";
import type { MarketAlert } from "@/components/notifications/MarketAlertCard";
import type { NiftyStrike } from "@/types/niftyReport";
import { burstToAlert, deriveOiSignal, entryFreshness } from "./niftyOiBursts";
import type { OiBurst, OiSignal } from "./niftyOiBursts";

/**
 * OI-burst alerts for the live Nifty report — plain React state, no store.
 *
 * Only minutes that arrive AFTER mount are announced: the first pass marks the
 * whole history as seen, so opening the page mid-session never replays the
 * morning. Switching context (mode/expiry/date) resets the seen-set.
 */

/** Transient toast lifetime; the inline trail keeps them longer. */
export const OI_ALERT_TTL_MS = 45_000;
/** Critical toasts stay up longer so the desk can act — independent of the
 * normal toast timer. */
export const OI_CRITICAL_TOAST_TTL_MS = 90_000;
/** Sticky critical banner lifetime (manual dismiss via X also supported). */
export const OI_CRITICAL_BANNER_TTL_MS = 5 * 60_000;
/** Most-recent critical banners shown at once (newest first). */
export const OI_CRITICAL_BANNER_MAX = 2;
/** Most-recent toasts shown at once. */
export const OI_ALERT_TOAST_MAX = 4;
/** Session trail length kept on the page (a full Nifty session can
 * produce ~45 bursts on expiry day). */
export const OI_ALERT_TRAIL_MAX = 60;

export interface NiftyOiAlerts {
  /** Every burst seen this session, newest first (persistent trail). */
  trail: MarketAlert[];
  /** The newest few, transient — the toast region. */
  toasts: MarketAlert[];
  /** Sticky critical banners (max OI_CRITICAL_BANNER_MAX, newest first). */
  banners: MarketAlert[];
  dismissToast: (id: string) => void;
  dismissBanner: (id: string) => void;
  clearTrail: () => void;
  /** Manually raise a toast (used by the after-hours REPLAY walk-through). */
  pushToast: (alert: MarketAlert) => void;
}

export function useNiftyOiAlerts(
  bursts: OiBurst[],
  chain: NiftyStrike[],
  spot: number,
  /** Session data has loaded (tape present). Arms the history gate. */
  ready: boolean,
  /** Live alerting: raise toasts for genuinely new minutes. */
  enabled: boolean,
  sessionKey: string,
  /**
   * Seed the trail with the day's bursts on prime (no toasts). Default true:
   * opening the page shows what the session has already produced, while only
   * genuinely new minutes ever toast.
   */
  seedTrail = true,
): NiftyOiAlerts {
  const [trail, setTrail] = useState<MarketAlert[]>([]);
  const [toasts, setToasts] = useState<MarketAlert[]>([]);
  const [banners, setBanners] = useState<MarketAlert[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);
  const sessionRef = useRef(sessionKey);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const bannerTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  /** Toast lifetime is severity-aware: criticals get the long timer. */
  const toastTtl = useCallback(
    (a: MarketAlert) =>
      a.severity === "critical" ? OI_CRITICAL_TOAST_TTL_MS : OI_ALERT_TTL_MS,
    [],
  );

  const scheduleToast = useCallback(
    (a: MarketAlert) => {
      const existing = timersRef.current.get(a.id);
      if (existing) clearTimeout(existing);
      timersRef.current.set(
        a.id,
        setTimeout(() => {
          setToasts((prev) => prev.filter((x) => x.id !== a.id));
          timersRef.current.delete(a.id);
        }, toastTtl(a)),
      );
    },
    [toastTtl],
  );

  const scheduleBanner = useCallback((a: MarketAlert) => {
    setBanners((prev) =>
      [a, ...prev.filter((x) => x.id !== a.id)].slice(0, OI_CRITICAL_BANNER_MAX),
    );
    const existing = bannerTimersRef.current.get(a.id);
    if (existing) clearTimeout(existing);
    bannerTimersRef.current.set(
      a.id,
      setTimeout(() => {
        setBanners((prev) => prev.filter((x) => x.id !== a.id));
        bannerTimersRef.current.delete(a.id);
      }, OI_CRITICAL_BANNER_TTL_MS),
    );
  }, []);

  /** Burst → renderable alert, preferring the backend's signal. */
  const toAlert = useCallback(
    (b: OiBurst): MarketAlert => {
      const signal: OiSignal | null =
        b.signal ??
        deriveOiSignal(b, chain, spot, { trend: b.trend ?? null, trend5m: b.trend5m ?? null });
      // A signal priced off a stale chain is void — mark it for re-pricing.
      const freshness = signal ? entryFreshness(signal, chain) : null;
      return burstToAlert(b, signal, { freshness });
    },
    [chain, spot],
  );

  // Context switch → new session: forget what we've seen and start clean.
  useEffect(() => {
    if (sessionRef.current === sessionKey) return;
    sessionRef.current = sessionKey;
    seenRef.current = new Set();
    primedRef.current = false;
    for (const t of timersRef.current.values()) clearTimeout(t);
    timersRef.current.clear();
    for (const t of bannerTimersRef.current.values()) clearTimeout(t);
    bannerTimersRef.current.clear();
    setTrail([]);
    setToasts([]);
    setBanners([]);
  }, [sessionKey]);

  useEffect(() => {
    // Arm only once the session feed has actually loaded. Priming on a
    // non-empty burst list would be wrong: a page opened before the first
    // burst would treat that first real burst as history and swallow it.
    if (!ready) return;

    if (!primedRef.current) {
      // Everything already on screen is history, not news. Arm even when the
      // list is empty.
      for (const b of bursts) seenRef.current.add(b.id);
      primedRef.current = true;
      if (seedTrail) {
        // Closed-market review: surface the day's bursts in the trail (no toasts).
        const seeded = bursts
          .slice(-OI_ALERT_TRAIL_MAX)
          .map(toAlert)
          .reverse();
        setTrail(seeded);
        // A critical already on the tape must be impossible to miss: seed the
        // sticky banners too (they still auto-dismiss from now).
        for (const a of seeded.filter((x) => x.severity === "critical" && x.actionable !== false).reverse()) {
          scheduleBanner(a);
        }
      }
      return;
    }

    // Only live modes announce new minutes.
    if (!enabled) return;

    const fresh = bursts.filter((b) => !seenRef.current.has(b.id));
    if (fresh.length === 0) return;
    for (const b of fresh) seenRef.current.add(b.id);

    const mapped = fresh
      .slice(-OI_ALERT_TOAST_MAX)
      .map(toAlert)
      .reverse();
    setTrail((prev) => [...mapped, ...prev].slice(0, OI_ALERT_TRAIL_MAX));
    setToasts((prev) => [...mapped, ...prev].slice(0, OI_ALERT_TOAST_MAX));

    for (const a of mapped) {
      scheduleToast(a);
    }
    // Oldest-first so the prepend in scheduleBanner lands newest-first.
    // Suppressed/stale plans are heads-ups, not instructions: no banner.
    for (const a of [...mapped].reverse()) {
      if (a.severity === "critical" && a.actionable !== false) scheduleBanner(a);
    }
  }, [bursts, chain, spot, ready, enabled, seedTrail, sessionKey, toAlert, scheduleToast, scheduleBanner]);

  useEffect(
    () => () => {
      for (const t of timersRef.current.values()) clearTimeout(t);
      for (const t of bannerTimersRef.current.values()) clearTimeout(t);
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

  const dismissBanner = useCallback((id: string) => {
    const t = bannerTimersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      bannerTimersRef.current.delete(id);
    }
    setBanners((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const clearTrail = useCallback(() => {
    setTrail([]);
    setBanners([]);
    for (const t of bannerTimersRef.current.values()) clearTimeout(t);
    bannerTimersRef.current.clear();
  }, []);

  const pushToast = useCallback(
    (alert: MarketAlert) => {
      setToasts((prev) => [alert, ...prev.filter((x) => x.id !== alert.id)].slice(0, OI_ALERT_TOAST_MAX));
      scheduleToast(alert);
      if (alert.severity === "critical" && alert.actionable !== false) scheduleBanner(alert);
    },
    [scheduleToast, scheduleBanner],
  );

  return { trail, toasts, banners, dismissToast, dismissBanner, clearTrail, pushToast };
}

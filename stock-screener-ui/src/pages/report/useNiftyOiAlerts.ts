import { useCallback, useEffect, useRef, useState } from "react";
import type { MarketAlert } from "@/components/notifications/MarketAlertCard";
import type { NiftyStrike } from "@/types/niftyReport";
import { burstToAlert, deriveOiSignal, dropConflictingSides, entryFreshness, isNonTradeAlertType, resolveOiDirection } from "./niftyOiBursts";
import { flashAlertTitle, playAlertSound, unlockAlertAudio } from "./alertSound";
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
/** The same setup (side + flow + strike) is not re-announced inside this
 * window. 2026-10-23 produced 60 bursts and 10 "critical" — without this the
 * banner/sound repeat the same idea every few minutes. */
export const OI_ALERT_COOLDOWN_MS = 10 * 60_000;
/** Minimum gap between two audible chirps, so a cluster is one cue. */
export const OI_SOUND_GAP_MS = 15_000;
/** Cap on the "already seen" burst ids kept for one session. A session
 *  produces ~60 bursts, so this only bites on a pathological feed — and it
 *  stops the set from pinning every burst id (and its strings) for the whole
 *  life of the tab. */
export const OI_ALERT_SEEN_MAX = 600;

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
  /** side:flow:strike → last announced epoch ms (cooldown). */
  const announcedRef = useRef<Map<string, number>>(new Map());
  /** Last audible cue, so a cluster chirps once. */
  const lastSoundRef = useRef(0);
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

  /** Burst → renderable alert. The backend plan wins only when it agrees
   * with who traded.
   *
   * The backend derives its `signal.leg` from the OI move alone (call unwind →
   * CE), while the burst also carries `flow`/`bearish` from `classify_flow`
   * (call unwind + premium down = **long liquidation** → PE). When those
   * disagree the banner used to read "LONGS LIQUIDATING → BUY CE" —
   * 2026-10-23 11:19, call unwind −2.55M, premChg −4.45, bearish true, signal
   * CE. The flow reading is the reason the alert fired, so it wins; the plan
   * is re-derived from the live chain instead of trusting the contradiction.
   */
  const toAlert = useCallback(
    (b: OiBurst): MarketAlert => {
      // Wall geometry + stale-data warnings carry no trade plan: map them
      // directly so no signal is derived from a zero-delta event.
      if (isNonTradeAlertType(b.type)) return burstToAlert(b);
      const flowDir = resolveOiDirection(b);
      const backendAgrees =
        b.signal != null && (flowDir == null || b.signal.leg === flowDir.leg);
      const signal: OiSignal | null = backendAgrees
        ? (b.signal as OiSignal)
        : deriveOiSignal(b, chain, spot, { trend: b.trend ?? null, trend5m: b.trend5m ?? null });
      // A signal priced off a stale chain is void — mark it for re-pricing.
      const freshness = signal ? entryFreshness(signal, chain) : null;
      return burstToAlert(b, signal, { freshness });
    },
    [chain, spot],
  );

  /** Remember burst ids without letting the set grow for the whole tab life.
   *  A Set preserves insertion order, so the hard cap drops the oldest ids. */
  const markSeen = useCallback((ids: string[]) => {
    for (const id of ids) seenRef.current.add(id);
    while (seenRef.current.size > OI_ALERT_SEEN_MAX) {
      const oldest = seenRef.current.values().next().value;
      if (oldest === undefined) break;
      seenRef.current.delete(oldest);
    }
  }, []);

  // Context switch → new session: forget what we've seen and start clean.
  useEffect(() => {
    if (sessionRef.current === sessionKey) return;
    sessionRef.current = sessionKey;
    seenRef.current = new Set();
    primedRef.current = false;
    announcedRef.current.clear();
    lastSoundRef.current = 0;
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
      markSeen(bursts.map((b) => b.id));
      primedRef.current = true;
      if (seedTrail) {
        // Closed-market review: surface the day's bursts in the trail (no toasts).
        // Opposite-side plans in the same minute are a pin, not two trades.
        const seeded = dropConflictingSides(bursts)
          .slice(-OI_ALERT_TRAIL_MAX)
          .map(toAlert)
          .reverse();
        setTrail(seeded);
        // A critical already on the tape must be impossible to miss — but only
        // if it is still FRESH. Seeding every critical on load made a 09:58
        // unwind reappear as a live banner at 10:45 (entry price long gone).
        // Only a LIVE feed gets the freshness rule. A replay/EOD session is
        // historical by definition (and panel fixtures use fixed dates), so it
        // still seeds every critical; a live feed whose newest burst is >12h
        // old is not live either.
        const newestTs = seeded.reduce((m, a) => Math.max(m, a.ts), 0);
        const liveFeed = enabled && newestTs > 0 && Date.now() - newestTs < 12 * 3_600_000;
        const bannerCutoff = liveFeed ? Date.now() - OI_CRITICAL_BANNER_TTL_MS : 0;
        for (const a of seeded
          .filter((x) => x.severity === "critical" && x.actionable !== false && x.ts >= bannerCutoff)
          .reverse()) {
          scheduleBanner(a);
        }
      }
      return;
    }

    // Only live modes announce new minutes.
    if (!enabled) return;

    const fresh = bursts.filter((b) => !seenRef.current.has(b.id));
    if (fresh.length === 0) return;
    markSeen(fresh.map((b) => b.id));

    // Two-sided writers in the same minute are a pin: drop both plans before
    // the cooldown/toast stage. Seen-marking above still prevents a re-announce.
    const usableFresh = dropConflictingSides(fresh);
    if (usableFresh.length === 0) return;

    // Cooldown: a new burst id with the same side + flow + strike is the same
    // idea, not new information. Keep the first, drop repeats for 10 minutes.
    const announced = announcedRef.current;
    const now = Date.now();
    const deduped = usableFresh.filter((b) => {
      // The event TYPE is part of the identity: a wall test at 11:54 and the
      // rejection of the same strike at 12:10 are two events, not a repeat.
      const key = `${b.type ?? "burst"}:${b.side}:${b.flow ?? ""}:${b.strike ?? ""}`;
      const last = announced.get(key) ?? 0;
      if (now - last < OI_ALERT_COOLDOWN_MS) return false;
      announced.set(key, now);
      return true;
    });
    if (announced.size > 200) {
      // Drop stale keys so the map cannot grow for the whole session.
      for (const [key, at] of announced) {
        if (now - at > OI_ALERT_COOLDOWN_MS) announced.delete(key);
      }
    }
    if (deduped.length === 0) return;

    const mapped = deduped
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

    // Audible + tab-title cue. A trader looking at the chart (or another tab)
    // will not see the toast rail; the critical chirp is the only channel that
    // reaches them. Silent on suppressed plans (actionable === false).
    const critical = mapped.find((a) => a.severity === "critical" && a.actionable !== false);
    if (critical) {
      if (now - lastSoundRef.current > OI_SOUND_GAP_MS) {
        playAlertSound("critical");
        lastSoundRef.current = now;
      }
      flashAlertTitle(critical.title);
    } else if (mapped.length > 0) {
      if (now - lastSoundRef.current > OI_SOUND_GAP_MS) {
        playAlertSound(mapped[0].severity === "alert" ? "alert" : "watch");
        lastSoundRef.current = now;
      }
    }
  }, [bursts, chain, spot, ready, enabled, seedTrail, sessionKey, toAlert, scheduleToast, scheduleBanner, markSeen]);

  // Browsers block audio until a gesture: unlock the context on the first one.
  useEffect(() => {
    const unlock = () => unlockAlertAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

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

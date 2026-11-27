import { batch, createEffect, createSignal, onCleanup, untrack } from "solid-js";
import type { MarketAlert } from "@/components/notifications/MarketAlertCard";
import type { NiftyStrike } from "@/types/niftyReport";
import { burstToAlert, deriveOiSignal, dropConflictingSides, entryFreshness, isNonTradeAlertType, resolveOiDirection } from "./niftyOiBursts";
import { flashAlertTitle, playAlertSound, unlockAlertAudio } from "./alertSound";
import type { OiBurst, OiSignal } from "./niftyOiBursts";


export const OI_ALERT_TTL_MS = 45_000;
export const OI_CRITICAL_TOAST_TTL_MS = 90_000;
export const OI_CRITICAL_BANNER_TTL_MS = 5 * 60_000;
export const OI_CRITICAL_BANNER_MAX = 2;
export const OI_ALERT_TOAST_MAX = 4;
export const OI_ALERT_TRAIL_MAX = 60;
export const OI_ALERT_COOLDOWN_MS = 10 * 60_000;
export const OI_SOUND_GAP_MS = 15_000;
export const OI_ALERT_SEEN_MAX = 600;

export interface NiftyOiAlerts {
  trail: () => MarketAlert[];
  toasts: () => MarketAlert[];
  banners: () => MarketAlert[];
  dismissToast: (id: string) => void;
  dismissBanner: (id: string) => void;
  clearTrail: () => void;
  /** Manually raise a toast (used by the after-hours REPLAY walk-through). */
  pushToast: (alert: MarketAlert) => void;
}

export function useNiftyOiAlerts(
  bursts: () => OiBurst[],
  chain: () => NiftyStrike[],
  spot: () => number,
  ready: () => boolean,
  enabled: () => boolean,
  sessionKey: () => string,
  seedTrail = true,
): NiftyOiAlerts {
  const [trail, setTrail] = createSignal<MarketAlert[]>([]);
  const [toasts, setToasts] = createSignal<MarketAlert[]>([]);
  const [banners, setBanners] = createSignal<MarketAlert[]>([]);
  let seen = new Set<string>();
  let primed = false;
  let sessionRef = sessionKey();
  /** side:flow:strike → last announced epoch ms (cooldown). */
  const announced = new Map<string, number>();
  let lastSound = 0;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const bannerTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const toastTtl = (a: MarketAlert) =>
    a.severity === "critical" ? OI_CRITICAL_TOAST_TTL_MS : OI_ALERT_TTL_MS;

  const scheduleToast = (a: MarketAlert) => {
    const existing = timers.get(a.id);
    if (existing) clearTimeout(existing);
    timers.set(
      a.id,
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== a.id));
        timers.delete(a.id);
      }, toastTtl(a)),
    );
  };

  const scheduleBanner = (a: MarketAlert) => {
    setBanners((prev) =>
      [a, ...prev.filter((x) => x.id !== a.id)].slice(0, OI_CRITICAL_BANNER_MAX),
    );
    const existing = bannerTimers.get(a.id);
    if (existing) clearTimeout(existing);
    bannerTimers.set(
      a.id,
      setTimeout(() => {
        setBanners((prev) => prev.filter((x) => x.id !== a.id));
        bannerTimers.delete(a.id);
      }, OI_CRITICAL_BANNER_TTL_MS),
    );
  };

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
   *
   * A backend that says `plan_suppressed` or `flow: "unconfirmed"` has already
   * looked for same-strike/spot confirmation and found none. Re-deriving from
   * OI + the chain would smuggle the very plan it withheld back onto the tape,
   * so those bursts carry no signal at all. Genuinely unlabelled legacy bursts
   * still get the derivation.
   */
  const toAlert = (b: OiBurst, chainNow: NiftyStrike[], spotNow: number): MarketAlert => {
      // Wall geometry, relocations, coils + stale-data warnings carry no trade
      // plan: map them directly so no signal is derived from a zero-delta event.
      if (isNonTradeAlertType(b.type)) return burstToAlert(b);
      const withheld = b.plan_suppressed === true || b.flow === "unconfirmed";
      const flowDir = withheld ? null : resolveOiDirection(b);
      const backendAgrees =
        !withheld && b.signal != null && (flowDir == null || b.signal.leg === flowDir.leg);
      const signal: OiSignal | null = withheld
        ? null
        : backendAgrees
          ? (b.signal as OiSignal)
          : deriveOiSignal(b, chainNow, spotNow, { trend: b.trend ?? null, trend5m: b.trend5m ?? null });
      // A signal priced off a stale chain is void — mark it for re-pricing.
      const freshness = signal ? entryFreshness(signal, chainNow) : null;
      return burstToAlert(b, signal, { freshness });
  };

  const markSeen = (ids: string[]) => {
    for (const id of ids) seen.add(id);
    while (seen.size > OI_ALERT_SEEN_MAX) {
      const oldest = seen.values().next().value;
      if (oldest === undefined) break;
      seen.delete(oldest);
    }
  };

  createEffect(() => {
    const key = sessionKey();
    if (sessionRef === key) return;
    sessionRef = key;
    seen = new Set();
    primed = false;
    announced.clear();
    lastSound = 0;
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    for (const t of bannerTimers.values()) clearTimeout(t);
    bannerTimers.clear();
    batch(() => {
      setTrail([]);
      setToasts([]);
      setBanners([]);
    });
  });

  createEffect(() => {
    const all = bursts();
    const isReady = ready();
    const isEnabled = enabled();
    sessionKey();
    if (!isReady) return;

    // Chain/spot move on every report frame but only matter when a burst is
    // actually mapped. Reading them untracked keeps this derivation off the
    // tick path; each run takes one consistent snapshot for the whole batch.
    const chainNow = untrack(chain);
    const spotNow = untrack(spot);

    if (!primed) {
      markSeen(all.map((b) => b.id));
      primed = true;
      if (seedTrail) {
        const seeded = dropConflictingSides(all)
          .slice(-OI_ALERT_TRAIL_MAX)
          .map((b) => toAlert(b, chainNow, spotNow))
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
        const liveFeed = isEnabled && newestTs > 0 && Date.now() - newestTs < 12 * 3_600_000;
        const bannerCutoff = liveFeed ? Date.now() - OI_CRITICAL_BANNER_TTL_MS : 0;
        for (const a of seeded
          .filter((x) => x.severity === "critical" && x.actionable !== false && x.ts >= bannerCutoff)
          .reverse()) {
          scheduleBanner(a);
        }
      }
      return;
    }

    if (!isEnabled) return;

    const fresh = all.filter((b) => !seen.has(b.id));
    if (fresh.length === 0) return;
    markSeen(fresh.map((b) => b.id));

    const usableFresh = dropConflictingSides(fresh);
    if (usableFresh.length === 0) return;

    const now = Date.now();
    const deduped = usableFresh.filter((b) => {
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
      .map((b) => toAlert(b, chainNow, spotNow))
      .reverse();
    batch(() => {
      setTrail((prev) => [...mapped, ...prev].slice(0, OI_ALERT_TRAIL_MAX));
      setToasts((prev) => [...mapped, ...prev].slice(0, OI_ALERT_TOAST_MAX));
    });

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
      if (now - lastSound > OI_SOUND_GAP_MS) {
        playAlertSound("critical");
        lastSound = now;
      }
      flashAlertTitle(critical.title);
    } else if (mapped.length > 0) {
      if (now - lastSound > OI_SOUND_GAP_MS) {
        playAlertSound(mapped[0].severity === "alert" ? "alert" : "watch");
        lastSound = now;
      }
    }
  });

  // Browsers block audio until a gesture: unlock the context on the first one.
  createEffect(() => {
    const unlock = () => unlockAlertAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    onCleanup(() => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    });
  });

  onCleanup(() => {
    for (const t of timers.values()) clearTimeout(t);
    for (const t of bannerTimers.values()) clearTimeout(t);
  });

  const dismissToast = (id: string) => {
    const t = timers.get(id);
    if (t) {
      clearTimeout(t);
      timers.delete(id);
    }
    setToasts((prev) => prev.filter((x) => x.id !== id));
  };

  const dismissBanner = (id: string) => {
    const t = bannerTimers.get(id);
    if (t) {
      clearTimeout(t);
      bannerTimers.delete(id);
    }
    setBanners((prev) => prev.filter((x) => x.id !== id));
  };

  const clearTrail = () => {
    batch(() => {
      setTrail([]);
      setBanners([]);
    });
    for (const t of bannerTimers.values()) clearTimeout(t);
    bannerTimers.clear();
  };

  const pushToast = (alert: MarketAlert) => {
    setToasts((prev) => [alert, ...prev.filter((x) => x.id !== alert.id)].slice(0, OI_ALERT_TOAST_MAX));
    scheduleToast(alert);
    if (alert.severity === "critical" && alert.actionable !== false) scheduleBanner(alert);
  };

  return { trail, toasts, banners, dismissToast, dismissBanner, clearTrail, pushToast };
}

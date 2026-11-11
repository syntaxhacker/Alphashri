import { useCallback, useEffect, useRef, useState } from "react";
import { fetchNiftyBlasts } from "@/api/reportNifty";
import type { NiftyBlast } from "@/api/reportNifty";
import { alertsMuted, flashAlertTitle, playAlertSound } from "./alertSound";

/**
 * Fast-move alerts — the 1-second tape and the 10-second chain.
 *
 * The OI-burst detector is 1-minute by construction, so it cannot see a
 * 15-point sprint or a 12M volume print inside one minute. This polls the
 * unified blast feed (pure file reads, no provider calls) and raises the same
 * sound/title treatment as an OI unwind.
 *
 * Thresholds are adaptive server-side; 8-10 pt moves are deliberately below
 * the gate (they fire dozens of times a session and teach you to ignore it).
 *
 * History is primed on mount: opening the tab mid-session must not replay the
 * morning's blasts as if they just fired.
 */

const POLL_MS = 3000;
const ALERT_TTL_MS = 120_000;

/**
 * Opening-bell guard.
 *
 * The first 15 minutes of the cash session are not a normal tape: the opening
 * gap, auction unwind and pre-positioning produce repeated 25–40 pt / 30 s
 * prints. At 09:16:59 on 2026-11-06 a +34.8 pt / 30 s spot blast is technically
 * true but operationally noise. Keep the feed, raise the gate.
 *
 * Outside the window the server's 15 pt / 10 s and 25 pt / 30 s gates stand.
 * Inside 09:15–09:30 IST require 25 pt / 10 s, 50 pt / 30 s, 4M OI or 30M
 * volume, and at most one audible/title alert per minute. The visual toast is
 * suppressed too, so the open does not become a notification slot machine.
 */
const OPENING_START_MIN = 9 * 60 + 15; // 09:15 IST
const OPENING_END_MIN = 9 * 60 + 30; // 09:30 IST
const OPENING_SPOT_10S_MIN = 25;
const OPENING_SPOT_30S_MIN = 50;
const OPENING_OI_MIN_M = 4.0;
const OPENING_VOL_MIN_M = 30.0;
const ALERT_GAP_MS = 15_000;
const OPENING_ALERT_GAP_MS = 60_000;
/** Cap on the dedupe keys kept for the session. The feed only looks back a few
 *  minutes, so an unbounded set of `kind:side:timestamp` keys would grow for
 *  the whole session without ever preventing a repeat. */
const MAX_SEEN_BLASTS = 500;

/** Minutes since midnight in IST, from the blast's ISO timestamp. The server
 *  writes IST offsets; the Intl fallback keeps this correct if the browser is
 *  in another timezone. */
function istMinutes(t: string): number | null {
  const match = t.match(/T(\d{2}):(\d{2})/);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  const date = new Date(t);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}

function isOpeningWindow(t: string): boolean {
  const minutes = istMinutes(t);
  return minutes !== null && minutes >= OPENING_START_MIN && minutes < OPENING_END_MIN;
}

function windowSeconds(label: string): number | null {
  const match = label.match(/\/\s*(\d+)s/);
  return match ? Number(match[1]) : null;
}

/** Raise the gate during the opening bell. Returns true when the blast is
 *  worth an alert (or when it is outside the opening window). */
function passesOpeningGate(b: NiftyBlast): boolean {
  if (!isOpeningWindow(b.t)) return true;
  if (b.kind === "spot") {
    const seconds = windowSeconds(b.label) ?? 10;
    return Math.abs(b.delta) >= (seconds >= 30 ? OPENING_SPOT_30S_MIN : OPENING_SPOT_10S_MIN);
  }
  if (b.kind === "oi") return Math.abs(b.delta) >= OPENING_OI_MIN_M;
  return Math.abs(b.delta) >= OPENING_VOL_MIN_M;
}

export interface BlastState {
  blast: NiftyBlast | null;
  dismiss: () => void;
}

export interface BlastOptions {
  /** How far back the server scans (default 5 min). */
  lookbackMin?: number;
}

export function useNiftyBlasts(enabled: boolean, opts: BlastOptions = {}): BlastState {
  const [blast, setBlast] = useState<NiftyBlast | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAlertRef = useRef(0);
  const { lookbackMin = 5 } = opts;

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setBlast(null);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const controller = new AbortController();

    const key = (b: NiftyBlast) => `${b.kind}:${b.side ?? ""}:${b.t}`;

    /** Insertion-ordered Set: drop the oldest keys once the cap is hit. */
    const remember = (keys: string[]) => {
      for (const k of keys) seenRef.current.add(k);
      while (seenRef.current.size > MAX_SEEN_BLASTS) {
        const oldest = seenRef.current.values().next().value;
        if (oldest === undefined) break;
        seenRef.current.delete(oldest);
      }
    };

    const load = () => {
      void fetchNiftyBlasts(lookbackMin, 40, controller.signal).then((rows) => {
        if (!alive) return;
        // Prime on the first successful poll EVEN IF EMPTY: arming on a
        // non-empty list would swallow the first real blast of the session.
        if (!primedRef.current) {
          remember(rows.map(key));
          primedRef.current = true;
          return;
        }
        if (rows.length === 0) return;
        const fresh = rows.filter((b) => !seenRef.current.has(key(b)));
        remember(rows.map(key));
        if (fresh.length === 0) return;

        // Opening-bell gate: raise spot/OI/volume thresholds and enforce a
        // one-per-minute cue. Suppressed blasts are still marked seen above,
        // so they cannot re-fire after the window ends.
        const gated = fresh.filter(passesOpeningGate);
        if (gated.length === 0) return;
        const latest = gated[gated.length - 1];
        const now = Date.now();
        const gap = isOpeningWindow(latest.t) ? OPENING_ALERT_GAP_MS : ALERT_GAP_MS;
        if (now - lastAlertRef.current < gap) return;
        lastAlertRef.current = now;

        setBlast(latest);
        if (!alertsMuted()) {
          playAlertSound(latest.severity === "warning" ? "alert" : "critical");
          flashAlertTitle(latest.label);
        }
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          setBlast(null);
        }, ALERT_TTL_MS);
      });
    };

    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
      controller.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [enabled, lookbackMin]);

  return { blast, dismiss };
}

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchUsDates, fetchUsEod, fetchUsLive, fetchUsPrice, fetchUsStatus, fetchUsTape } from "../../../api/usReport";
import type { UsEod, UsMode, UsRow, UsStatus } from "../../../types/usReport";

export interface UsReportState {
  row: UsRow | null;
  frames: UsRow[];
  eod: UsEod | null;
  status: UsStatus | null;
  dates: string[];
  date: string;
  cursor: number;
  playing: boolean;
  speed: number;
  loading: boolean;
  error: string | null;
  setDate: (d: string) => void;
  setCursor: (i: number) => void;
  togglePlay: () => void;
  setSpeed: (n: number) => void;
  refresh: () => void;
}

/**
 * Live poll (15 s) in ``live`` mode; tape frames + EOD card in ``eod`` mode.
 * In EOD the tape is fetched once and played back locally — no upstream calls.
 */
export function useUsReport(root: string, mode: UsMode): UsReportState {
  const [row, setRow] = useState<UsRow | null>(null);
  const [liveFrames, setLiveFrames] = useState<UsRow[]>([]);
  const [frames, setFrames] = useState<UsRow[]>([]);
  const [eod, setEod] = useState<UsEod | null>(null);
  const [status, setStatus] = useState<UsStatus | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [date, setDateState] = useState("");
  const [cursor, setCursorState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // reset when the root changes
  useEffect(() => {
    setDateState("");
    setFrames([]);
    setLiveFrames([]);
    setEod(null);
    setRow(null);
    setCursorState(0);
    setPlaying(false);
    setLoading(true);
  }, [root]);

  const setDate = useCallback((d: string) => {
    setDateState(d);
    setCursorState(0);
    setPlaying(false);
  }, []);

  const setCursor = useCallback((i: number) => {
    setCursorState(i);
  }, []);

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      if (!p && frames.length > 1) setCursorState(0);
      return !p;
    });
  }, [frames.length]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // ---- live mode -----------------------------------------------------------
  useEffect(() => {
    if (mode !== "live") return undefined;
    let timer: ReturnType<typeof setInterval> | null = null;
    let priceTimer: ReturnType<typeof setInterval> | null = null;
    let statusTimer: ReturnType<typeof setInterval> | null = null;

    const todayEt = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    fetchUsTape(root, todayEt)
      .then((tape) => {
        if (alive.current) setLiveFrames(tape.rows.slice(-390));
      })
      .catch(() => undefined);

    // Merge a full chain row (30 s) into the current minute's candle.
    const mergeChain = (r: UsRow) =>
      setLiveFrames((prev) => {
        const minute = r.t.slice(0, 16);
        const prevMinute = prev.filter((x) => x.t.slice(0, 16) !== minute);
        const base = prevMinute[prevMinute.length - 1];
        const o = r.o ?? base?.c ?? base?.spot ?? r.spot;
        const merged: UsRow = {
          ...r,
          o,
          h: r.h ?? Math.max(o, r.spot),
          l: r.l ?? Math.min(o, r.spot),
          c: r.c ?? r.spot,
        };
        prevMinute.push(merged);
        prevMinute.sort((a, b) => a.t.localeCompare(b.t));
        return prevMinute.slice(-390);
      });

    // 5 s price tick: update (or open) the current 1-minute candle.
    const applyPrice = (px: number, t: string) =>
      setLiveFrames((prev) => {
        if (!prev.length) return prev;
        const minute = t.slice(0, 16);
        const out = prev.slice();
        const last = out[out.length - 1];
        if (last.t.slice(0, 16) === minute) {
          const o = last.o ?? last.spot;
          out[out.length - 1] = {
            ...last,
            t,
            spot: px,
            o,
            h: Math.max(last.h ?? o, px),
            l: Math.min(last.l ?? o, px),
            c: px,
          };
        } else {
          out.push({
            ...last,
            t,
            spot: px,
            o: last.c ?? last.spot,
            h: px,
            l: px,
            c: px,
          });
        }
        return out.slice(-390);
      });

    const chainTick = async () => {
      try {
        const live = await fetchUsLive(root);
        if (!alive.current) return;
        setRow(live.row);
        mergeChain(live.row);
        setError(null);
      } catch (e) {
        if (alive.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive.current) setLoading(false);
      }
    };

    const priceTick = async () => {
      try {
        const p = await fetchUsPrice(root);
        if (!alive.current) return;
        applyPrice(p.spot, p.t);
      } catch {
        /* a missed tick is harmless — the 30 s chain poll still lands */
      }
    };

    const statusTick = async () => {
      try {
        const st = await fetchUsStatus();
        if (alive.current) setStatus(st);
      } catch {
        /* status is cosmetic */
      }
    };

    void chainTick();
    void priceTick();
    void statusTick();
    timer = setInterval(() => void chainTick(), 30_000);
    priceTimer = setInterval(() => void priceTick(), 5_000);
    statusTimer = setInterval(() => void statusTick(), 30_000);
    return () => {
      if (timer) clearInterval(timer);
      if (priceTimer) clearInterval(priceTimer);
      if (statusTimer) clearInterval(statusTimer);
    };
  }, [root, mode, nonce]);

  // ---- EOD mode ------------------------------------------------------------
  useEffect(() => {
    if (mode !== "eod") return undefined;
    let cancelled = false;

    const loadDates = async () => {
      try {
        const res = await fetchUsDates(root);
        if (cancelled) return;
        setDates(res.dates);
        if (!date && res.dates.length) setDateState(res.dates[0]);
        if (!res.dates.length) {
          setFrames([]);
          setEod(null);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    };

    void loadDates();
    return () => {
      cancelled = true;
    };
    // `date` intentionally excluded: dates are discovered once per root
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, mode]);

  useEffect(() => {
    if (mode !== "eod" || !date) return undefined;
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const [tape, summary] = await Promise.all([fetchUsTape(root, date), fetchUsEod(root, date)]);
        if (cancelled) return;
        setFrames(tape.rows);
        setEod(summary);
        setCursorState(Math.max(0, tape.rows.length - 1));
        setPlaying(false);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setFrames([]);
          setEod(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [root, mode, date, nonce]);

  // ---- playback ------------------------------------------------------------
  useEffect(() => {
    if (!playing || mode !== "eod" || frames.length < 2) return undefined;
    const id = setInterval(() => {
      setCursorState((c) => {
        if (c >= frames.length - 1) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, Math.max(40, Math.round(1000 / Math.max(1, speed))));
    return () => clearInterval(id);
  }, [playing, mode, frames.length, speed]);

  const liveRow = liveFrames.length ? liveFrames[liveFrames.length - 1] : row;
  const frame = mode === "live" ? liveRow : (frames[cursor] ?? (frames.length ? frames[frames.length - 1] : null));
  const shownFrames = mode === "live" ? liveFrames : frames;
  const shownCursor = mode === "live" ? Math.max(0, shownFrames.length - 1) : cursor;

  return {
    row: frame,
    frames: shownFrames,
    eod,
    status,
    dates,
    date,
    cursor: shownCursor,
    playing,
    speed,
    loading,
    error,
    setDate,
    setCursor,
    togglePlay,
    setSpeed,
    refresh,
  };
}

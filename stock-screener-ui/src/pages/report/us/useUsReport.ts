import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { usePolling } from "../../../hooks/usePolling";

import { fetchUsDates, fetchUsEod, fetchUsLive, fetchUsPrice, fetchUsStatus, fetchUsTape } from "../../../api/usReport";
import type { UsEod, UsMode, UsRow, UsStatus } from "../../../types/usReport";

export interface UsReportState {
  row: () => UsRow | null;
  frames: () => UsRow[];
  eod: () => UsEod | null;
  status: () => UsStatus | null;
  dates: () => string[];
  date: () => string;
  cursor: () => number;
  playing: () => boolean;
  speed: () => number;
  loading: () => boolean;
  error: () => string | null;
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
export function useUsReport(root: () => string, mode: () => UsMode): UsReportState {
  const [row, setRow] = createSignal<UsRow | null>(null);
  const [liveFrames, setLiveFrames] = createSignal<UsRow[]>([]);
  const [frames, setFrames] = createSignal<UsRow[]>([]);
  const [eod, setEod] = createSignal<UsEod | null>(null);
  const [status, setStatus] = createSignal<UsStatus | null>(null);
  const [dates, setDates] = createSignal<string[]>([]);
  const [date, setDateState] = createSignal("");
  const [cursor, setCursorState] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [speed, setSpeed] = createSignal(4);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [nonce, setNonce] = createSignal(0);

  let alive = true;
  onCleanup(() => {
    alive = false;
  });

  // reset when the root changes
  createEffect(() => {
    root();
    setDateState("");
    setFrames([]);
    setLiveFrames([]);
    setEod(null);
    setRow(null);
    setCursorState(0);
    setPlaying(false);
    setLoading(true);
  });

  const setDate = (d: string) => {
    setDateState(d);
    setCursorState(0);
    setPlaying(false);
  };

  const setCursor = (i: number) => {
    setCursorState(i);
  };

  const togglePlay = () => {
    setPlaying((p) => {
      if (!p && frames().length > 1) setCursorState(0);
      return !p;
    });
  };

  const refresh = () => setNonce((n) => n + 1);

  // ---- live mode -----------------------------------------------------------
  createEffect(() => {
    if (mode() !== "live") return;
    nonce();
    let timer: ReturnType<typeof setInterval> | null = null;
    let priceTimer: ReturnType<typeof setInterval> | null = null;
    let statusTimer: ReturnType<typeof setInterval> | null = null;

    const todayEt = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    fetchUsTape(root(), todayEt)
      .then((tape) => {
        if (alive) setLiveFrames(tape.rows.slice(-390));
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
        const live = await fetchUsLive(root());
        if (!alive) return;
        setRow(live.row);
        mergeChain(live.row);
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    };

    const priceTick = async () => {
      try {
        const p = await fetchUsPrice(root());
        if (!alive) return;
        applyPrice(p.spot, p.t);
      } catch {
        /* a missed tick is harmless — the 30 s chain poll still lands */
      }
    };

    const statusTick = async () => {
      try {
        const st = await fetchUsStatus();
        if (alive) setStatus(st);
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
    onCleanup(() => {
      if (timer) clearInterval(timer);
      if (priceTimer) clearInterval(priceTimer);
      if (statusTimer) clearInterval(statusTimer);
    });
  });

  // ---- EOD mode ------------------------------------------------------------
  createEffect(() => {
    if (mode() !== "eod") return;
    root();
    let cancelled = false;

    const loadDates = async () => {
      try {
        const res = await fetchUsDates(root());
        if (cancelled) return;
        setDates(res.dates);
        if (!date() && res.dates.length) setDateState(res.dates[0]);
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
    onCleanup(() => {
      cancelled = true;
    });
  });

  createEffect(() => {
    if (mode() !== "eod" || !date()) return;
    nonce();
    const currentDate = date();
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const [tape, summary] = await Promise.all([fetchUsTape(root(), currentDate), fetchUsEod(root(), currentDate)]);
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
    onCleanup(() => {
      cancelled = true;
    });
  });

  // ---- playback ------------------------------------------------------------
  const playbackMs = () => Math.max(40, Math.round(1000 / Math.max(1, speed())));
  usePolling(
    () => {
      setCursorState((c) => {
        if (c >= frames().length - 1) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    },
    playbackMs(),
    { enabled: playing() && mode() === "eod" && frames().length >= 2, skipIfRunning: false },
  );

  const liveRow = () => {
    const lf = liveFrames();
    return lf.length ? lf[lf.length - 1] : row();
  };
  const frame = () => {
    if (mode() === "live") return liveRow();
    const rows = frames();
    const idx = Math.min(cursor(), Math.max(0, rows.length - 1));
    return rows[idx] ?? (rows.length ? rows[rows.length - 1] : null);
  };
  const shownFrames = () => (mode() === "live" ? liveFrames() : frames());
  const shownCursor = () =>
    mode() === "live" ? Math.max(0, shownFrames().length - 1) : cursor();

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

// useReplayClock — owns the RAF playback loop extracted from pages/poc/TickReplay.
// Controlled by the page (playing/speed live in React state); the hook drives a
// 10fps paint callback + a 4fps React clock update, and reports end-of-replay.
import { useCallback, useEffect, useRef, useState } from "react";

export interface UseReplayClockOptions {
  /** first replay timestamp (epoch sec); 0 disables seeding */
  t0: number;
  /** last replay timestamp (epoch sec); falsy disables the loop entirely */
  tEnd: number;
  /** controlled play/pause */
  playing: boolean;
  /** controlled playback speed multiplier */
  speed: number;
  /** 10fps paint callback (canvas/imperative chart) */
  onTick: (now: number) => void;
  /** called once playback reaches tEnd (page clears its playing state) */
  onEnd?: () => void;
}

export interface ReplayClock {
  /** React state clock for text/table (4fps while playing) */
  clock: number;
  /** live clock ref for imperative reads (slider/button/handlers) */
  clockRef: React.RefObject<number>;
  /** timestamp of the last paint (ms), exposed for subclassed loops */
  lastPaintRef: React.RefObject<number>;
  /** jump to an absolute timestamp: reset paint, sync both clock stores */
  jump: (v: number) => void;
}

export function useReplayClock({ t0, tEnd, playing, speed, onTick, onEnd }: UseReplayClockOptions): ReplayClock {
  const [clock, setClock] = useState(0);
  const clockRef = useRef(0);
  const lastPaintRef = useRef(0);
  const speedRef = useRef(speed);
  const onTickRef = useRef(onTick);
  const onEndRef = useRef(onEnd);
  const rafRef = useRef(0);

  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { onTickRef.current = onTick; }, [onTick]);
  useEffect(() => { onEndRef.current = onEnd; }, [onEnd]);

  const jump = useCallback((v: number) => {
    clockRef.current = v;
    lastPaintRef.current = 0;
    setClock(v);
    onTickRef.current?.(v);
  }, []);

  // playback loop: canvas paints at 10fps, React text/table renders at 4fps
  useEffect(() => {
    if (!playing || !tEnd) return;
    if (clockRef.current <= 0 && t0 > 0) {
      clockRef.current = t0;
      setClock(t0);
      onTickRef.current?.(t0);
    }
    let last: number | null = null; // lazy: first frame only arms, never jumps
    let lastUi = 0;
    const step = (t: number) => {
      if (last == null) {
        last = t;
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      const dt = (t - last) / 1000;
      last = t;
      const next = Math.min(tEnd, clockRef.current + dt * speedRef.current);
      if (t - lastPaintRef.current > 100 || next >= tEnd) {
        lastPaintRef.current = t;
        clockRef.current = next;
        onTickRef.current?.(next);
        if (t - lastUi > 250 || next >= tEnd) {
          lastUi = t;
          setClock(next);
        }
      } else {
        clockRef.current = next;
      }
      if (next >= tEnd) {
        onEndRef.current?.();
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, t0, tEnd]);

  return { clock, clockRef, lastPaintRef, jump };
}

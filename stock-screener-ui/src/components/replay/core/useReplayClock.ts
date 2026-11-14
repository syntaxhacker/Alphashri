// useReplayClock — owns the RAF playback loop extracted from pages/poc/TickReplay.
// Controlled by the page (playing/speed live in the page); the hook drives a
// 10fps paint callback + a 4fps clock update, and reports end-of-replay.
import { createEffect, createSignal, onCleanup } from "solid-js";

export interface UseReplayClockOptions {
  /** first replay timestamp (epoch sec); 0 disables seeding */
  t0: number | (() => number);
  /** last replay timestamp (epoch sec); falsy disables the loop entirely */
  tEnd: number | (() => number);
  /** controlled play/pause */
  playing: boolean | (() => boolean);
  /** controlled playback speed multiplier */
  speed: number | (() => number);
  /** 10fps paint callback (canvas/imperative chart) */
  onTick: (now: number) => void;
  /** called once playback reaches tEnd (page clears its playing state) */
  onEnd?: () => void;
}

export interface ReplayClock {
  /** clock for text/table rendering (4fps while playing) */
  clock: () => number;
  /** live clock ref for imperative reads (slider/button/handlers) */
  clockRef: { current: number };
  /** timestamp of the last paint (ms), exposed for subclassed loops */
  lastPaintRef: { current: number };
  /** jump to an absolute timestamp: reset paint, sync both clock stores */
  jump: (v: number) => void;
}

const acc = <T,>(v: T | (() => T)): (() => T) =>
  typeof v === "function" ? (v as () => T) : () => v;

export function useReplayClock(opts: UseReplayClockOptions): ReplayClock {
  const [clock, setClock] = createSignal(0);
  const clockRef = { current: 0 };
  const lastPaintRef = { current: 0 };
  let rafId = 0;

  const jump = (v: number) => {
    clockRef.current = v;
    lastPaintRef.current = 0;
    setClock(v);
    opts.onTick(v);
  };

  // playback loop: chart paints at 10fps, UI text renders at 4fps
  createEffect(() => {
    const playing = acc(opts.playing)();
    const tEnd = acc(opts.tEnd)();
    const t0 = acc(opts.t0)();
    if (!playing || !tEnd) return;

    if (clockRef.current <= 0 && t0 > 0) {
      clockRef.current = t0;
      setClock(t0);
      opts.onTick(t0);
    }

    let last: number | null = null; // lazy: first frame only arms, never jumps
    let lastUi = 0;
    let stopped = false;
    const speedNow = () => acc(opts.speed)();
    const step = (t: number) => {
      if (stopped) return;
      if (last == null) {
        last = t;
        rafId = requestAnimationFrame(step);
        return;
      }
      const dt = (t - last) / 1000;
      last = t;
      const next = Math.min(tEnd, clockRef.current + dt * speedNow());
      if (t - lastPaintRef.current > 100 || next >= tEnd) {
        lastPaintRef.current = t;
        clockRef.current = next;
        opts.onTick(next);
        if (t - lastUi > 250 || next >= tEnd) {
          lastUi = t;
          setClock(next);
        }
      } else {
        clockRef.current = next;
      }
      if (next >= tEnd) {
        opts.onEnd?.();
        return;
      }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);

    onCleanup(() => {
      stopped = true;
      cancelAnimationFrame(rafId);
    });
  });

  return { clock, clockRef, lastPaintRef, jump };
}

/**
 * Motion presets for the options replay UI.
 *
 * Every preset animates only `transform` / `opacity`: no width, height, margin
 * or padding, so charts and the positions table keep their exact geometry.
 * Utilities are Tailwind classes backed by the `--color-fin-*` tokens (the CSS
 * mirror of palette.ts), so no colour literal is introduced here.
 *
 * Two independent reduced-motion guards are used on purpose:
 *  - each preset carries `motion-reduce:*` variants, so the CSS is safe even if
 *    the JS helper is never called (e.g. a preference changed after mount);
 *  - `reducedMotionClass()` is the JS gate that supplies the actual
 *    `transition-property`, returning a no-op when the OS asks for less motion.
 */
import * as palette from "@/ui/palette";

export type ReplayMotionKind = "playhead" | "tile" | "panel" | "button" | "state";

/** Playhead highlight ink, imported from the single colour source, never restated. */
export const PLAYHEAD_ACCENT = palette.PRIMARY;

const NO_TRANSITION = "motion-reduce:transition-none motion-reduce:transform-none";

/**
 * Pure presets: durations, easing and state modifiers only. The shared
 * `transition-property` comes from `reducedMotionClass()` so a reduced-motion
 * user gets no transition at all without any timers or DOM changes.
 */
const PRESETS: Record<ReplayMotionKind, string> = {
  playhead: `duration-150 ease-out will-change-transform ${NO_TRANSITION}`,
  tile: `duration-200 ease-out will-change-transform ${NO_TRANSITION}`,
  panel: `duration-300 ease-out ${NO_TRANSITION}`,
  button: `duration-150 ease-out hover:scale-[1.02] active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:active:scale-100`,
  state: `duration-200 ease-out will-change-transform ${NO_TRANSITION}`,
};

/** Pure: the static preset for a kind. No window / matchMedia access. */
export function transitionClass(kind: ReplayMotionKind): string {
  return PRESETS[kind] ?? "";
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Lazily reads matchMedia so importing this module is SSR / test safe. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * Returns an empty (no-op) class when the user prefers reduced motion,
 * otherwise the shared transform/opacity transition property. Append it next
 * to a `transitionClass(...)` preset on every animated node.
 */
export function reducedMotionClass(): string {
  return prefersReducedMotion() ? "" : "transition-[transform,opacity]";
}

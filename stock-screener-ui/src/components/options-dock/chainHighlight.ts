import type { OptionChainLevels } from "@/api/optionsDock";

export type LevelKey = "cw" | "pw" | "mp";
export type RailKey = "cw" | "pw";

export interface ChainHighlight {
  keys: LevelKey[];
  tint?: string;
  rails: RailKey[];
}

/**
 * Canonical order — used for both `keys` and the row's `data-level` attribute so
 * a wall/pain combination always serialises the same way.
 */
const KEY_ORDER: readonly LevelKey[] = ["cw", "pw", "mp"];

/**
 * Solid ink for each row-edge rail. CSS vars (not palette hex) keep the rail
 * theme-aware: `--color-fin-negative/positive/warning` are guarded to equal the
 * NEGATIVE / POSITIVE / WARNING palette tokens in both schemes.
 */
export const LEVEL_RAIL_COLOR: Record<LevelKey, string> = {
  cw: "var(--color-fin-negative)", // call wall = resistance (red)
  pw: "var(--color-fin-positive)", // put wall = support (green)
  mp: "var(--color-fin-warning)", // max pain = amber equilibrium
};

/**
 * Row tints. Built with a custom property in mind: a bare color-mix in
 * `background-color` is silently dropped by DOM style shims, so the consumer
 * assigns this string to a `--level-tint` custom property and paints with
 * `background-color: var(--level-tint)` (same pattern as the ATM row).
 */
export const LEVEL_TINT: Record<LevelKey, string> = {
  cw: "color-mix(in srgb, var(--color-fin-negative) 8%, var(--color-fin-surface))",
  pw: "color-mix(in srgb, var(--color-fin-positive) 8%, var(--color-fin-surface))",
  mp: "color-mix(in srgb, var(--color-fin-warning) 7%, var(--color-fin-surface))",
};

/** Build the inset box-shadow for a row's level rails (left CW, right PW). */
export function railShadow(rails: RailKey[]): string | undefined {
  if (rails.length === 0) return undefined;
  return rails
    .map((key) => `inset ${key === "cw" ? 2 : -2}px 0 0 ${LEVEL_RAIL_COLOR[key]}`)
    .join(", ");
}

/**
 * Detect which strike levels (call wall / put wall / max pain) land on `strike`.
 * Pure: no store access, no DOM — just level data in, highlight descriptor out.
 *
 * A call wall and put wall at the same strike mark an equilibrium. Two rails
 * say that clearly; a red+green tint would only turn muddy, so that case stays
 * rails-only (`tint` undefined).
 */
export function highlightChainLevels(
  levels: OptionChainLevels | null | undefined,
  strike: number,
): ChainHighlight {
  const cw = levels?.callWall?.strike === strike;
  const pw = levels?.putWall?.strike === strike;
  const mp = levels?.maxPain?.strike === strike;

  const present = new Set<LevelKey>();
  if (cw) present.add("cw");
  if (pw) present.add("pw");
  if (mp) present.add("mp");
  const keys = KEY_ORDER.filter((key) => present.has(key));

  const rails: RailKey[] = [];
  if (cw) rails.push("cw");
  if (pw) rails.push("pw");

  let tint: string | undefined;
  if (cw && pw) {
    tint = undefined;
  } else if (cw) {
    tint = LEVEL_TINT.cw;
  } else if (pw) {
    tint = LEVEL_TINT.pw;
  } else if (mp) {
    tint = LEVEL_TINT.mp;
  }

  return { keys, ...(tint ? { tint } : {}), rails };
}

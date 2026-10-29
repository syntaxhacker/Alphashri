/**
 * The desk plan's data contract.
 *
 * Split out of `deskPlan.ts` so the level maths, the reason builders and the
 * plan builder can share the types without importing each other.
 */

export type DeskBias = "bullish" | "bearish" | "neutral";

/** Reason buckets, in render/weight order. */
export const DESK_REASON_TAGS = [
  "trend",
  "gamma",
  "oi",
  "vol",
  "structure",
] as const;

export type DeskReasonTag = (typeof DESK_REASON_TAGS)[number];

export interface DeskReason {
  tag: DeskReasonTag;
  /** One numeric sentence — the actual levels/ratios, never a generic claim. */
  text: string;
}

export type DeskSideKey = "bull" | "bear";

/** How the desk enters a side of the book. */
export type DeskEntryKind = "break" | "rejection" | "failed_breakdown" | "none";

/**
 * One concrete entry: the level that has to give, the invalidation behind it
 * and the next structural level in the trade's direction. `rr` is always
 * measured from the trigger, never from spot, so a wide trigger cannot flatter
 * the ratio.
 */
export interface DeskEntry {
  kind: DeskEntryKind;
  /** Human-readable trigger naming the level and the confirmation. */
  trigger: string;
  /** Numeric level the trigger is measured against (index points). */
  triggerLevel: number | null;
  /** Invalidation beyond the trigger (index points). */
  stop: number | null;
  /** Next structural level in the trade's direction (index points). */
  target: number | null;
  /** Reward ÷ risk on this entry; `null` when trigger/stop/target is missing. */
  rr: number | null;
}

export interface DeskSide {
  side: DeskSideKey;
  /** Active side gets the directional badge; the other reads NEUTRAL. */
  bias: DeskBias;
  action: string;
  /** Primary entry — the break the desk wants to see. */
  entryKind: DeskEntryKind;
  /** Human-readable primary trigger (the break, never the counter-case). */
  entryTrigger: string;
  /** Numeric level the primary trigger is measured against. */
  triggerLevel: number | null;
  /** Invalidation beyond the trigger — level + max(8 pts, 0.08%). */
  stop: number | null;
  /** Next level in the trade's direction. */
  target: number | null;
  /** Reward:risk on the primary entry, computed from the trigger level. */
  rr: number | null;
  /** Counter-case entry: rejection (bear) / failed breakdown (bull). */
  alternate: DeskEntry | null;
  /** 2–3 numeric "don't do this" bullets. */
  doNots: string[];
  /** Ordered by `DESK_REASON_TAGS`; missing data omits its bucket. */
  reasons: DeskReason[];
}

export interface DeskPlan {
  bias: DeskBias;
  /** Spot the plan was computed from (`0`/missing → `null`). */
  spot: number | null;
  /** Nearest level below spot from pivots/GEX fuel-down/put walls/session low. */
  support: number | null;
  /** Nearest level above spot from pivots/GEX resistance/call walls/session high. */
  resistance: number | null;
  /** Downside confirmation — the lower of support and the session low. */
  downsideBreak: number | null;
  /** One-line instruction shown when the tape is neutral. */
  waitNote: string;
  bull: DeskSide;
  bear: DeskSide;
}

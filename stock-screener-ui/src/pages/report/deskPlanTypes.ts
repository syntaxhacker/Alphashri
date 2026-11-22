/**
 * The desk plan's data contract.
 *
 * Split out of `deskPlan.ts` so the level maths, the reason builders and the
 * plan builder can share the types without importing each other.
 */

export type DeskBias = "bullish" | "bearish" | "neutral";

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
  text: string;
}

export type DeskSideKey = "bull" | "bear";

export type DeskEntryKind = "break" | "rejection" | "failed_breakdown" | "none";

export interface DeskEntry {
  kind: DeskEntryKind;
  trigger: string;
  triggerLevel: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
}

export interface DeskSide {
  side: DeskSideKey;
  bias: DeskBias;
  action: string;
  entryKind: DeskEntryKind;
  entryTrigger: string;
  triggerLevel: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
  alternate: DeskEntry | null;
  doNots: string[];
  /** Ordered by `DESK_REASON_TAGS`; missing data omits its bucket. */
  reasons: DeskReason[];
}

export interface DeskPlan {
  bias: DeskBias;
  spot: number | null;
  support: number | null;
  resistance: number | null;
  downsideBreak: number | null;
  waitNote: string;
  bull: DeskSide;
  bear: DeskSide;
}

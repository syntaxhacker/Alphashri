import { Badge } from "@/ui";
import type { EventType } from "../../types/events";

/** Human labels for the frozen `EventType` union. */
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  investor_day: "Investor Day",
  analyst_day: "Analyst Day",
  capital_markets_day: "Capital Markets Day",
  strategy_day: "Strategy Day",
  rnd_day: "R&D Day",
  business_update: "Business Update",
  guidance: "Guidance",
  shareholder_meeting: "Shareholder Mtg",
  earnings: "Earnings",
  dividend: "Dividend",
  split: "Split",
  other: "Other",
};

/**
 * The "alpha" event types — the scheduled catalysts that tend to re-rate a
 * story rather than simply report a quarter. Kept here (next to the labels) and
 * re-exported by `EventsFilters` so the badge and the filter cannot drift.
 */
export const ALPHA_EVENT_TYPES: EventType[] = [
  "investor_day",
  "analyst_day",
  "capital_markets_day",
  "strategy_day",
  "rnd_day",
  "business_update",
  "guidance",
];

const MUTED_EVENT_TYPES = new Set<EventType>(["earnings", "dividend", "split"]);

/**
 * Coloured type chip.
 *
 * Alpha types are filled in the primary accent, routine corporate actions are
 * muted, and guidance gets the warning tone because a guidance change resets
 * the earnings model. `size="xs"` + `nowrap` keeps rows dense.
 */
export function EventTypeBadge({
  type,
  isAlpha,
}: {
  type: EventType;
  isAlpha?: boolean;
}) {
  const alpha = isAlpha ?? ALPHA_EVENT_TYPES.includes(type);
  const isGuidance = type === "guidance";
  const muted = MUTED_EVENT_TYPES.has(type);

  const color = isGuidance ? "warning" : alpha ? "primary" : muted ? "default" : "secondary";
  const variant = isGuidance || alpha ? "filled" : "light";

  return (
    <Badge
      size="xs"
      color={color}
      variant={variant}
      style={{ whiteSpace: "nowrap" }}
    >
      {EVENT_TYPE_LABELS[type] ?? "Other"}
    </Badge>
  );
}

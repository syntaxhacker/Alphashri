import { useEffect, useState } from "react";
import { Box, Button, Select, Switch, TextInput, ToolbarRow } from "@/ui";
import { IconRefresh } from "@tabler/icons-react";
import { isoDate } from "../../state/events";
import type { EventMarket, EventsQuery } from "../../types/events";
import { ALPHA_EVENT_TYPES } from "./EventTypeBadge";

export { ALPHA_EVENT_TYPES };

const MARKET_OPTIONS: { value: EventMarket; label: string }[] = [
  { value: "us", label: "US" },
  { value: "india", label: "India" },
  { value: "all", label: "All" },
];

/** Calendar windows. "All upcoming" is a far horizon, not an empty range —
 *  the store repairs a missing `to` back to +90 days. */
export const EVENT_WINDOWS = [
  { value: "7", label: "Next 7 days", days: 7 },
  { value: "30", label: "Next 30 days", days: 30 },
  { value: "90", label: "Next 90 days", days: 90 },
  { value: "all", label: "All upcoming", days: 3650 },
] as const;

export type EventWindowValue = (typeof EVENT_WINDOWS)[number]["value"];

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

/** The from/to pair a window writes into the query. */
export function windowRange(
  value: EventWindowValue,
  now: Date = new Date(),
): { from: string; to: string } {
  const option = EVENT_WINDOWS.find((w) => w.value === value) ?? EVENT_WINDOWS[2];
  return { from: isoDate(now), to: isoDate(addDays(now, option.days)) };
}

/** Pick the option that matches the current `to` (falls back to 90 days). */
export function resolveWindowValue(query: EventsQuery, now: Date = new Date()): EventWindowValue {
  if (query.to === undefined) return "all";
  const match = EVENT_WINDOWS.find(
    (w) => w.value !== "all" && query.to === isoDate(addDays(now, w.days)),
  );
  if (match) return match.value;
  const all = windowRange("all", now);
  return query.to === all.to ? "all" : "90";
}

interface EventsFiltersProps {
  query: EventsQuery;
  onChange: (patch: Partial<EventsQuery>) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

/**
 * Controlled filter bar for the Event Radar calendar.
 *
 * Pure: every control only emits a `Partial<EventsQuery>` patch. Network work
 * (and the resulting loading flags) belongs to the store via `useEvents`.
 */
export function EventsFilters({ query, onChange, onRefresh, isRefreshing }: EventsFiltersProps) {
  const alphaOnly = query.types === ALPHA_EVENT_TYPES.join(",");
  const windowValue = resolveWindowValue(query);

  // Symbols are committed (trim + upper-case) on blur/Enter, so typing a list
  // does not fire a request per keystroke.
  const [symbolDraft, setSymbolDraft] = useState(query.symbols ?? "");
  useEffect(() => {
    setSymbolDraft(query.symbols ?? "");
  }, [query.symbols]);

  const commitSymbols = (): void => {
    const normalized = symbolDraft
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .join(",");
    setSymbolDraft(normalized);
    if (normalized !== (query.symbols ?? "")) {
      onChange({ symbols: normalized || undefined });
    }
  };

  return (
    <ToolbarRow gap={8} data-testid="events-filters">
      <Select
        value={query.market ?? "us"}
        onChange={(value) => onChange({ market: (value ?? "us") as EventMarket })}
        data={MARKET_OPTIONS}
        size="sm"
        w={140}
        aria-label="Market"
        data-testid="events-market-select"
      />
      <Select
        value={windowValue}
        onChange={(value) =>
          onChange(windowRange((value ?? "90") as EventWindowValue))
        }
        data={EVENT_WINDOWS.map((w) => ({ value: w.value, label: w.label }))}
        size="sm"
        w={160}
        aria-label="Window"
        data-testid="events-window-select"
      />
      <Switch
        checked={alphaOnly}
        onChange={(e) =>
          onChange({ types: e.currentTarget.checked ? ALPHA_EVENT_TYPES.join(",") : undefined })
        }
        label="Alpha only"
        size="sm"
        data-testid="events-alpha-only"
      />
      <Box onBlur={commitSymbols} sx={{ display: "inline-flex" }}>
        <TextInput
          value={symbolDraft}
          onChange={setSymbolDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitSymbols();
            }
          }}
          placeholder="Symbols (e.g. AAPL, MSFT)"
          size="sm"
          w={200}
          aria-label="Symbols"
          data-testid="events-symbols-input"
        />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }} />
      <Button
        size="sm"
        variant="outline"
        leftSection={<IconRefresh size={14} />}
        onClick={onRefresh}
        loading={isRefreshing}
        data-testid="events-refresh"
      >
        Refresh
      </Button>
    </ToolbarRow>
  );
}

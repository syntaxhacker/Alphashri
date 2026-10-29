import { useEffect, useState } from "react";
import { Alert, Box, Text } from "@/ui";
import { useEvents } from "../../hooks/useEvents";
import { isoDate } from "../../state/events";
import { formatTimeOnly } from "../../utils/ui-helpers";
import type { AnomalyDTO, EventDTO, EventsQuery } from "../../types/events";
import { CompactPanel, CompactStat } from "../common/compact";
import { EventDetailDrawer } from "./EventDetailDrawer";
import { EventsFilters } from "./EventsFilters";
import { EventsTable } from "./EventsTable";

const DEFAULT_RANGE_DAYS = 90;
const MAX_ANOMALIES = 4;

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function initialQuery(now: Date = new Date()): EventsQuery {
  return {
    market: "us",
    from: isoDate(now),
    to: isoDate(addDays(now, DEFAULT_RANGE_DAYS)),
    upcoming_only: true,
  };
}

function anomalyTone(retPct: number): string {
  if (retPct > 0) return "success";
  if (retPct < 0) return "error";
  return "text.primary";
}

function anomalyValue(anomaly: AnomalyDTO): string {
  const sign = anomaly.ret_pct > 0 ? "+" : "";
  return `${sign}${anomaly.ret_pct.toFixed(2)}%`;
}

/**
 * Event Radar tab.
 *
 * The panel owns only the query object and the selected row; the calendar
 * payload, anomalies and loading flags all live in `eventsStore` through
 * `useEvents`, so a second consumer always sees the same slice.
 */
export function EventsPanel() {
  const [query, setQuery] = useState<EventsQuery>(() => initialQuery());
  const [selected, setSelected] = useState<EventDTO | null>(null);
  const { events, anomalies, isLoading, isRefreshing, error, lastUpdated, refresh, loadAnomalies } =
    useEvents(query);

  useEffect(() => {
    loadAnomalies(isoDate(new Date()));
  }, [loadAnomalies]);

  const patchQuery = (patch: Partial<EventsQuery>): void => {
    setQuery((prev) => ({ ...prev, ...patch }));
  };

  const shownAnomalies = anomalies?.anomalies.slice(0, MAX_ANOMALIES) ?? [];

  return (
    <CompactPanel
      testId="events-panel"
      title="Corporate Events"
      description="Investor days, analyst days and other scheduled catalysts"
      action={
        <Text size="xs" c="dimmed" data-testid="events-last-updated" title={lastUpdated ?? undefined}>
          {lastUpdated ? `updated ${formatTimeOnly(lastUpdated)}` : "not loaded"}
        </Text>
      }
      scrollable
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 1,
          minHeight: 0,
          height: "100%",
        }}
      >
        <EventsFilters
          query={query}
          onChange={patchQuery}
          onRefresh={refresh}
          isRefreshing={isRefreshing}
        />

        {shownAnomalies.length > 0 && (
          <Box
            data-testid="events-anomalies"
            sx={{ display: "flex", flexDirection: "column", gap: 1 }}
          >
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" sx={{ fontSize: 10, letterSpacing: "0.4px" }}>
              Unexplained moves
            </Text>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 1,
              }}
            >
              {shownAnomalies.map((anomaly) => (
                <CompactStat
                  key={`${anomaly.symbol}-${anomaly.ts}`}
                  dense
                  label={anomaly.symbol}
                  value={anomalyValue(anomaly)}
                  tone={anomalyTone(anomaly.ret_pct)}
                  hint={`vol ${anomaly.vol_ratio.toFixed(1)}x`}
                  data-testid={`events-anomaly-${anomaly.symbol}`}
                />
              ))}
            </Box>
          </Box>
        )}

        {error && (
          <Alert color="error" data-testid="events-error">
            {error.message}
          </Alert>
        )}

        {!(error && events.length === 0) && (
          <EventsTable events={events} isLoading={isLoading} onOpen={setSelected} />
        )}
      </Box>

      <EventDetailDrawer event={selected} onClose={() => setSelected(null)} />
    </CompactPanel>
  );
}

import { For, Show, createEffect, createSignal } from "solid-js";
import { Alert, Box, Text } from "@/ui";
import { useEventsSolid } from "./useEventsSolid";
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
  const [query, setQuery] = createSignal<EventsQuery>(initialQuery());
  const [selected, setSelected] = createSignal<EventDTO | null>(null);
  const { events, anomalies, isLoading, isRefreshing, error, lastUpdated, refresh, loadAnomalies } =
    useEventsSolid(query);

  createEffect(() => {
    loadAnomalies(isoDate(new Date()));
  });

  const patchQuery = (patch: Partial<EventsQuery>): void => {
    setQuery((prev) => ({ ...prev, ...patch }));
  };

  const shownAnomalies = () => anomalies()?.anomalies.slice(0, MAX_ANOMALIES) ?? [];

  return (
    <CompactPanel
      testId="events-panel"
      title="Corporate Events"
      description="Investor days, analyst days and other scheduled catalysts"
      action={
        <Text size="xs" c="dimmed" data-testid="events-last-updated" title={lastUpdated() ?? undefined}>
          {lastUpdated() ? `updated ${formatTimeOnly(lastUpdated()!)}` : "not loaded"}
        </Text>
      }
      scrollable
    >
      <Box className="flex flex-col gap-0.5" style={{ "min-height": 0, height: "100%" }}>
        <EventsFilters
          query={query()}
          onChange={patchQuery}
          onRefresh={refresh}
          isRefreshing={isRefreshing()}
        />

        <Show when={shownAnomalies().length > 0}>
          <Box
            data-testid="events-anomalies"
            className="flex flex-col gap-0.5"
          >
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" className="text-[10px] tracking-[0.4px]">
              Unexplained moves
            </Text>
            <Box
              className="grid gap-0.5"
              style={{ "grid-template-columns": "repeat(auto-fill, minmax(140px, 1fr))" }}
            >
              <For each={shownAnomalies()}>{(anomaly) => (
                <CompactStat
                  dense
                  label={anomaly.symbol}
                  value={anomalyValue(anomaly)}
                  tone={anomalyTone(anomaly.ret_pct)}
                  hint={`vol ${anomaly.vol_ratio.toFixed(1)}x`}
                  data-testid={`events-anomaly-${anomaly.symbol}`}
                />
              )}</For>
            </Box>
          </Box>
        </Show>

        <Show when={error()}>
          <Alert color="error" data-testid="events-error">
            {error()!.message}
          </Alert>
        </Show>

        <Show when={!(error() && events().length === 0)}>
          <EventsTable events={events()} isLoading={isLoading()} onOpen={setSelected} />
        </Show>
      </Box>

      <EventDetailDrawer event={selected()} onClose={() => setSelected(null)} />
    </CompactPanel>
  );
}

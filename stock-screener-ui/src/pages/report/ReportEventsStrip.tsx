import { For, Show } from "solid-js";
import { Alert, Badge, Skeleton, Text } from "@/ui";
import type { ReportEventKind, ReportEventsResponse } from "../../types/report";
import { symbolRowCursor, symbolRowProps } from "../../components/common/symbolRowProps";

interface ReportEventsStripProps {
  data: ReportEventsResponse | null;
  loading: boolean;
  error: string | null;
  onOpenSymbol?: (symbol: string) => void;
}

const KIND_LABEL: Record<ReportEventKind, string> = {
  results: "Results",
  dividend: "Dividend",
  split: "Split",
};

const KIND_COLOR: Record<ReportEventKind, "info" | "success" | "warning"> = {
  results: "info",
  dividend: "success",
  split: "warning",
};

export function ReportEventsStrip(props: ReportEventsStripProps) {
  const events = () => props.data?.events ?? [];
  return (
    <Show
      when={!props.loading}
      fallback={
        <div class="flex flex-col gap-2" data-testid="report-events-loading">
          <Skeleton h={16} />
          <Skeleton h={16} />
        </div>
      }
    >
      <Show
        when={!props.error}
        fallback={
          <div data-testid="report-events-error">
            <Alert color="error" data-testid="report-events-error-alert">
              {props.error}
            </Alert>
          </div>
        }
      >
        <Show when={events().length > 0}>
          <div
            data-testid="report-events-strip"
            class="min-w-0 border border-fin-border rounded-[2px] bg-fin-surface"
          >
            <div class="flex items-center gap-2 px-2 pt-2">
              <Text size="xs" fw={600} truncate span className="flex-1 min-w-0" data-testid="report-events-title">
                Upcoming results & events
              </Text>
              <Badge size="xs" data-testid="report-events-window">
                {props.data?.from ?? ""} → {props.data?.to ?? ""}
              </Badge>
              <Badge size="xs" data-testid="report-events-count">
                {events().length}
              </Badge>
            </div>
            <div class="flex flex-col px-2 py-1" data-testid="report-events-rows">
              <For each={events()}>
                {(ev) => (
                  <div
                    // Same symbol can appear for results + dividend on one date.
                    data-testid={`report-events-row-${ev.symbol}-${ev.kind}`}
                    data-symbol={ev.symbol}
                    {...symbolRowProps(props.onOpenSymbol, ev.symbol)}
                    class="flex items-center gap-2 min-w-0 py-1 border-b border-fin-border tabular-nums"
                    style={{ cursor: symbolRowCursor(props.onOpenSymbol) }}
                  >
                    <Text size="xs" c="dimmed" span className="font-mono shrink-0 tabular-nums">
                      {ev.date}
                    </Text>
                    <Text size="xs" fw={700} truncate span title={ev.symbol} className="shrink-0">
                      {ev.symbol}
                    </Text>
                    <Badge size="xs" color={KIND_COLOR[ev.kind]}>
                      {KIND_LABEL[ev.kind]}
                    </Badge>
                    <Text size="xs" c="dimmed" truncate span className="flex-1 min-w-0" title={ev.title}>
                      {ev.title}
                    </Text>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </Show>
    </Show>
  );
}

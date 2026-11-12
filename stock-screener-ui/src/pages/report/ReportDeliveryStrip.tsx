import { For, Show } from "solid-js";
import { Alert, Badge, Skeleton, Text } from "@/ui";
import type { DeliveryResponse } from "../../types/report";
import { formatCurrency, formatNumber } from "../../utils/ui-helpers";
import { symbolRowCursor, symbolRowProps } from "../../components/common/symbolRowProps";

interface ReportDeliveryStripProps {
  data: DeliveryResponse | null;
  loading: boolean;
  error: string | null;
  onOpenSymbol?: (symbol: string) => void;
}

function formatPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}%`;
}

export function ReportDeliveryStrip(props: ReportDeliveryStripProps) {
  const rows = () => props.data?.rows ?? [];
  return (
    <Show
      when={!props.loading}
      fallback={
        <div class="flex flex-col gap-2" data-testid="report-delivery-loading">
          <Skeleton h={16} />
          <Skeleton h={16} />
        </div>
      }
    >
      <Show
        when={!props.error}
        fallback={
          <div data-testid="report-delivery-error">
            <Alert color="error" data-testid="report-delivery-error-alert">
              {props.error}
            </Alert>
          </div>
        }
      >
        <Show when={rows().length > 0}>
          <div
            data-testid="report-delivery-strip"
            class="min-w-0 border border-fin-border rounded-[2px] bg-fin-surface"
          >
            <div class="flex items-center gap-2 px-2 pt-2">
              <Text size="xs" fw={600} truncate span className="flex-1 min-w-0" data-testid="report-delivery-title">
                High delivery %
              </Text>
              <Badge size="xs" data-testid="report-delivery-date">
                {props.data?.date ?? ""}
              </Badge>
              <Badge size="xs" data-testid="report-delivery-source">
                NSE bhavcopy
              </Badge>
            </div>
            <div
              data-testid="report-delivery-rows"
              class="flex gap-2 overflow-x-auto px-2 py-2 tabular-nums"
            >
              <For each={rows()}>
                {(row) => (
                  <div
                    data-testid={`report-delivery-row-${row.symbol}`}
                    data-symbol={row.symbol}
                    {...symbolRowProps(props.onOpenSymbol, row.symbol)}
                    class="flex flex-col gap-0 min-w-[120px] shrink-0 tabular-nums"
                    style={{ cursor: symbolRowCursor(props.onOpenSymbol) }}
                  >
                    <Text size="xs" fw={700} truncate span title={row.symbol}>
                      {row.symbol}
                    </Text>
                    <Text size="xs" fw={700} span className="tabular-nums">
                      {formatPct(row.delivery_pct)}
                    </Text>
                    <Text size="xs" c="dimmed" span className="tabular-nums">
                      {formatNumber(row.delivery_qty)} / {formatNumber(row.traded_qty)}
                    </Text>
                    <Text size="xs" c="dimmed" span className="tabular-nums">
                      {formatCurrency(row.close, 2)}
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

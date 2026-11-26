import { For, Show, createMemo } from "solid-js";
import { NEGATIVE, TEXT_MUTED, alpha } from "@/ui/palette";
import type { SectorHistoryRisk, SectorHistorySeries } from "../../../../types/sectorHistory";
import { formatPercentage } from "../../../../utils/ui-helpers";
import { MiniSparkline } from "../visuals/MiniSparkline";
import { CHART_MUTED, CHART_NEGATIVE, CHART_POSITIVE } from "../visuals/chartPalette";
import { buildRiskRows, type RiskRow } from "../RiskTable.columns";

const DASH = "—";

interface MetricSpec {
  key: "current_drawdown" | "recovery_days" | "sharpe" | "volatility";
  label: string;
  testId: (name: string) => string;
  format: (value: number) => string;
}

const METRICS: MetricSpec[] = [
  {
    key: "current_drawdown",
    label: "Cur DD",
    testId: (name) => `sector-history-risk-current-dd-${name}`,
    format: (value) => formatPercentage(value, 1, false),
  },
  {
    key: "recovery_days",
    label: "Recovery",
    testId: (name) => `sector-history-risk-recovery-${name}`,
    format: (value) => `${Math.round(value)}d`,
  },
  {
    key: "sharpe",
    label: "Sharpe",
    testId: (name) => `sector-history-risk-sharpe-${name}`,
    format: (value) => value.toFixed(2),
  },
  {
    key: "volatility",
    label: "Vol",
    testId: (name) => `sector-history-risk-volatility-${name}`,
    format: (value) => formatPercentage(value, 1, false),
  },
];

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function RiskBarRow(props: { row: RiskRow }) {
  const name = () => props.row.name;
  const hasDrawdown = () => props.row.barFraction !== null;
  const barWidth = () => `${((props.row.barFraction ?? 0) * 100).toFixed(2)}%`;
  const maxLabel = () => formatPercentage(props.row.max_drawdown, 1, false);
  const maxTone = () => {
    const value = props.row.max_drawdown;
    if (!finite(value) || value === 0) return "text-fin-text-muted";
    return value < 0 ? "text-fin-negative" : "text-fin-text";
  };

  const cumulativeText = () =>
    props.row.cumulative === null ? DASH : formatPercentage(props.row.cumulative, 1);
  const cumulativeColor = () => {
    const value = props.row.cumulative;
    if (value === null) return CHART_MUTED;
    return value >= 0 ? CHART_POSITIVE : CHART_NEGATIVE;
  };
  const cumulativeTitle = () =>
    `Cumulative return ${
      props.row.cumulative === null ? DASH : formatPercentage(props.row.cumulative, 1)
    }`;

  return (
    <li
      data-testid={`sector-history-risk-row-${name()}`}
      data-sector={name()}
      data-null-drawdown={hasDrawdown() ? undefined : "true"}
      class="grid min-w-0 grid-cols-2 items-center gap-x-3 gap-y-1 border-b border-fin-border py-2 last:border-b-0 lg:grid-cols-[minmax(140px,220px)_minmax(0,1fr)_auto_auto]"
    >
      <span
        class="col-span-2 min-w-0 truncate text-ui-micro font-semibold text-fin-text lg:col-span-1"
        title={name()}
      >
        {name()}
      </span>

      <div class="col-span-2 flex min-w-0 items-center gap-2 lg:col-span-1">
        <div class="relative h-3 min-w-0 flex-1">
          <div
            data-testid={`sector-history-risk-track-${name()}`}
            data-zero-edge="right"
            class="absolute inset-y-0.5 left-0 right-0 overflow-hidden rounded-sm"
            style={{ "background-color": alpha(TEXT_MUTED, 0.16) }}
            aria-hidden="true"
          >
            <Show when={hasDrawdown()}>
              <div
                data-testid={`sector-history-risk-bar-${name()}`}
                data-origin="right"
                data-bar-fraction={props.row.barFraction ?? undefined}
                class="absolute inset-y-0 right-0 rounded-sm"
                style={{ width: barWidth(), "background-color": NEGATIVE }}
              />
            </Show>
          </div>
          <span
            aria-hidden="true"
            data-testid={`sector-history-risk-zero-${name()}`}
            class="absolute inset-y-0 right-0 w-px bg-fin-border"
          />
        </div>
        <span
          data-testid={`sector-history-risk-max-dd-${name()}`}
          class={`w-[52px] shrink-0 text-right font-mono text-ui-micro tabular-nums ${maxTone()}`}
        >
          {maxLabel()}
        </span>
      </div>

      <dl
        data-testid={`sector-history-risk-metrics-${name()}`}
        class="col-span-2 grid min-w-0 grid-cols-2 gap-x-4 gap-y-0.5 lg:col-span-1 lg:grid-cols-4 lg:gap-x-3"
      >
        <For each={METRICS}>
          {(metric) => {
            const value = () => props.row[metric.key];
            const missing = () => !finite(value());
            return (
              <div class="flex min-w-0 items-baseline justify-between gap-1 lg:block">
                <dt class="text-ui-micro leading-tight text-fin-text-muted">{metric.label}</dt>
                <dd
                  data-testid={metric.testId(name())}
                  class={`m-0 font-mono text-ui-micro leading-tight tabular-nums ${
                    missing() ? "text-fin-text-muted" : "text-fin-text"
                  }`}
                >
                  {missing() ? DASH : metric.format(value() as number)}
                </dd>
              </div>
            );
          }}
        </For>
      </dl>

      <div
        data-testid={`sector-history-risk-spark-${name()}`}
        class="col-span-2 flex min-w-0 items-center justify-between gap-2 lg:col-span-1 lg:justify-end"
        title={cumulativeTitle()}
        aria-label={cumulativeTitle()}
        role="group"
      >
        <MiniSparkline values={props.row.spark} width={72} height={18} tone="neutral" />
        <span
          data-testid={`sector-history-risk-cumulative-${name()}`}
          class="font-mono text-ui-micro tabular-nums whitespace-nowrap"
          style={{ color: cumulativeColor() }}
        >
          {cumulativeText()}
        </span>
      </div>
    </li>
  );
}

export interface RiskDrawdownPanelProps {
  risk: SectorHistoryRisk[];
  series: SectorHistorySeries[];
}

/**
 * The risk surface is a list of direct-labeled drawdown bars, not a table:
 * names and values sit beside their own bar, and the four secondary metrics
 * collapse into a two-column grid under the bar on narrow screens.
 */
export function RiskDrawdownPanel(props: RiskDrawdownPanelProps) {
  const model = createMemo(() => buildRiskRows(props.risk, props.series));

  return (
    <div
      data-testid="sector-history-risk-table"
      data-scale={model().scale}
      class="min-w-0"
    >
      <Show
        when={model().rows.length > 0}
        fallback={
          <div
            data-testid="sector-history-risk-table-empty"
            class="flex min-h-[96px] items-center justify-center px-2 py-4"
          >
            <span class="text-ui-micro text-center text-fin-text-muted">No risk metrics</span>
          </div>
        }
      >
        <ul
          data-testid="sector-history-risk-bars"
          class="m-0 flex list-none flex-col p-0"
        >
          <For each={model().rows}>{(row) => <RiskBarRow row={row} />}</For>
        </ul>
      </Show>
    </div>
  );
}

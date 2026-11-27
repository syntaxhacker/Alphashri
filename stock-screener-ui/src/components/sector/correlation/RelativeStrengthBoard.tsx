import { For, createMemo } from "solid-js";
import { alpha, CHART_NEGATIVE, CHART_POSITIVE, CHART_TOP3 } from "@/ui/palette";
import { formatSectorPercentage as formatPercentage } from "../sectorUtils";
import { signed, strengthRows, type CorrelationSector } from "./model";

function Metric(props: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
}) {
  const color = () =>
    props.positive ? CHART_POSITIVE : props.negative ? CHART_NEGATIVE : undefined;
  return (
    <span class="inline-flex min-w-0 items-baseline gap-1 whitespace-nowrap">
      <span class="text-ui-micro text-fin-text-muted">{props.label}</span>
      <span
        class="font-mono text-ui-micro tabular-nums"
        style={color() ? { color: color() } : undefined}
      >
        {props.value}
      </span>
    </span>
  );
}

/**
 * A ranked board, not a table: a sector label is not a chart symbol, so rows
 * stay display-only. Every value carries its own short label, letting the
 * narrow layout wrap cells without a second legend or a rotated header.
 */
export function RelativeStrengthBoard(props: {
  sectors: CorrelationSector[];
  isDark: boolean;
}) {
  const rows = createMemo(() => strengthRows(props.sectors));

  return (
    <div
      data-testid="correlation-rs-board"
      data-theme={props.isDark ? "dark" : "light"}
      class="flex min-w-0 flex-col gap-0.5"
    >
      <For each={rows()}>
        {(sector, index) => {
          const change = sector.rank_change_1m;
          const top3 = sector.rank_current <= 3;
          const rs5 = sector.relative_strength_5d;
          const rs1 = sector.relative_strength_1m;
          const rs3 = sector.relative_strength_3m;
          // A return that prints 0.00% must not keep the red/green tone of a
          // sub-basis-point float.
          const tone = (value: number) => Number(value.toFixed(2));
          return (
            <div
              data-testid={`correlation-rs-row-${index()}`}
              data-sector={sector.name}
              data-rank={sector.rank_current}
              class="grid min-w-0 grid-cols-[32px_minmax(0,1fr)] items-center gap-x-1 gap-y-0.5 rounded-sm px-1 py-0.5 text-left md:grid-cols-[32px_minmax(88px,1fr)_repeat(5,minmax(0,68px))]"
            >
              <span
                data-testid={`correlation-rs-badge-${index()}`}
                class="inline-flex h-4 min-w-6 items-center justify-center rounded-sm border px-1 font-mono text-ui-micro tabular-nums"
                style={
                  top3
                    ? {
                        color: CHART_TOP3,
                        "border-color": alpha(CHART_TOP3, 0.5),
                        "background-color": alpha(CHART_TOP3, 0.14),
                      }
                    : undefined
                }
              >
                #{sector.rank_current}
              </span>
              <span
                class={`truncate text-ui-micro ${top3 ? "font-semibold text-fin-text" : "text-fin-text-muted"}`}
                title={sector.name}
              >
                {sector.name}
              </span>
              <span class="col-span-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 md:col-span-1 md:contents">
                <Metric
                  label="5D"
                  value={formatPercentage(rs5, 2, true)}
                  positive={tone(rs5) > 0}
                  negative={tone(rs5) < 0}
                />
                <Metric
                  label="1M"
                  value={formatPercentage(rs1, 2, true)}
                  positive={tone(rs1) > 0}
                  negative={tone(rs1) < 0}
                />
                <Metric
                  label="3M"
                  value={formatPercentage(rs3, 2, true)}
                  positive={tone(rs3) > 0}
                  negative={tone(rs3) < 0}
                />
                <Metric label="Beta" value={sector.beta_vs_index.toFixed(2)} />
                <Metric
                  label="Δ1M"
                  value={signed(change)}
                  positive={change > 0}
                  negative={change < 0}
                />
              </span>
            </div>
          );
        }}
      </For>
    </div>
  );
}

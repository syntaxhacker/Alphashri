import { For, createMemo } from "solid-js";
import { alpha, CHART_CURRENT, TEXT_MUTED } from "@/ui/palette";
import { betaRows, type CorrelationSector } from "./model";

/** Marks occupy part of the track; the rest is the direct-label gutter. */
const PLOT_SPAN = 0.72;
const LABEL_GAP_PX = 8;

/** Lollipop domain: keep 1.0 inside it and leave room for the direct label. */
function betaDomain(values: number[]): { min: number; max: number } {
  const observed = values.filter((value) => Number.isFinite(value));
  const low = Math.min(0, ...observed);
  const high = Math.max(1, ...observed);
  const padding = Math.max(0.12, (high - low) * 0.14);
  return { min: Math.max(0, low - padding), max: high + padding };
}

export function BetaDotPlot(props: {
  sectors: CorrelationSector[];
  benchmark: string;
  isDark: boolean;
}) {
  const rows = createMemo(() => betaRows(props.sectors));
  const domain = createMemo(() =>
    betaDomain(rows().map((sector) => sector.beta_vs_index)),
  );
  const pct = (beta: number) => {
    const { min, max } = domain();
    return ((beta - min) / (max - min)) * PLOT_SPAN * 100;
  };
  const railPct = () => pct(1);

  return (
    <div
      data-testid="correlation-beta-dot-plot"
      data-theme={props.isDark ? "dark" : "light"}
      class="flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-auto"
    >
      <div
        data-testid="correlation-beta-header"
        class="flex flex-col items-start gap-0.5 px-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-x-2"
      >
        <span class="min-w-0 text-ui-micro font-semibold text-fin-text">
          Beta vs Benchmark · {props.benchmark}
        </span>
        <span class="inline-flex min-w-0 items-center gap-1 whitespace-nowrap text-ui-micro text-fin-text-muted">
          <span
            aria-hidden="true"
            class="inline-block h-3 w-0 border-l border-dashed"
            style={{ "border-color": alpha(TEXT_MUTED, 0.75) }}
          />
          1.0 = benchmark
        </span>
      </div>

      <div class="grid min-w-0 grid-cols-[minmax(64px,1fr)_minmax(0,1.8fr)] gap-1 px-1">
        <span />
        <span class="relative h-3">
          <span
            data-testid="correlation-beta-rail-label"
            class="absolute -translate-x-1/2 text-ui-micro text-fin-text-muted"
            style={{ left: `${railPct()}%` }}
          >
            1.0
          </span>
        </span>
      </div>

      <div class="flex min-w-0 flex-col gap-0.5 px-1 pb-1">
        <For each={rows()}>
          {(sector, index) => {
            const beta = sector.beta_vs_index;
            const dot = () => pct(beta);
            const rail = () => railPct();
            const stemLeft = () => Math.min(dot(), rail());
            const stemWidth = () => Math.abs(dot() - rail());
            return (
              <div
                data-testid={`correlation-beta-row-${index()}`}
                data-sector={sector.name}
                data-beta={beta}
                class="grid min-w-0 grid-cols-[minmax(64px,1fr)_minmax(0,1.8fr)] items-center gap-1 rounded-sm px-1 py-0.5 text-left"
              >
                <span class="truncate text-ui-micro text-fin-text" title={sector.name}>
                  {sector.name}
                </span>
                <span class="relative h-4 min-w-0">
                  <span
                    aria-hidden="true"
                    data-testid={`correlation-beta-rail-${index()}`}
                    class="absolute inset-y-0 border-l border-dashed"
                    style={{
                      left: `${rail()}%`,
                      "border-color": alpha(TEXT_MUTED, 0.55),
                    }}
                  />
                  <span
                    aria-hidden="true"
                    data-testid={`correlation-beta-stem-${index()}`}
                    class="absolute top-1/2 h-px -translate-y-1/2"
                    style={{
                      left: `${stemLeft()}%`,
                      width: `${stemWidth()}%`,
                      "background-color": alpha(TEXT_MUTED, 0.8),
                    }}
                  />
                  <span
                    aria-hidden="true"
                    data-testid={`correlation-beta-dot-${index()}`}
                    class="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border"
                    style={{
                      left: `${dot()}%`,
                      "background-color": CHART_CURRENT,
                      "border-color": alpha(CHART_CURRENT, 0.5),
                    }}
                  />
                  <span
                    data-testid={`correlation-beta-value-${index()}`}
                    class="absolute top-1/2 -translate-y-1/2 whitespace-nowrap font-mono text-ui-micro tabular-nums text-fin-text"
                    style={{ left: `calc(${dot()}% + ${LABEL_GAP_PX}px)` }}
                  >
                    {beta.toFixed(2)}
                  </span>
                </span>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}

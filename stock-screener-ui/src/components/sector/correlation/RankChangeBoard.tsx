import { For, Show, createMemo } from "solid-js";
import {
  alpha,
  CHART_NEGATIVE,
  CHART_POSITIVE,
  CHART_TOP3,
  TEXT_MUTED,
} from "@/ui/palette";
import { rankChangeRows, signed, type CorrelationSector } from "./model";

/** Bars stop short of the edge so the signed value can sit beside the bar end. */
const BAR_MAX_PCT = 38;

export function RankChangeBoard(props: {
  sectors: CorrelationSector[];
  isDark: boolean;
}) {
  const rows = createMemo(() => rankChangeRows(props.sectors));
  const scale = createMemo(() =>
    Math.max(1, ...rows().map((sector) => Math.abs(sector.rank_change_1m))),
  );
  const barPct = (value: number) => (Math.abs(value) / scale()) * BAR_MAX_PCT;

  return (
    <div
      data-testid="correlation-rank-change"
      data-theme={props.isDark ? "dark" : "light"}
      class="flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-auto"
    >
      <div class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 px-1">
        <span class="text-ui-micro font-semibold text-fin-text">Rank change · 1 month</span>
        <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ui-micro text-fin-text-muted">
          <span
            data-testid="correlation-rank-key-up"
            class="inline-flex items-center gap-1"
          >
            <span
              aria-hidden="true"
              class="inline-block h-2 w-2 rounded-sm"
              style={{ "background-color": CHART_POSITIVE }}
            />
            rose
          </span>
          <span
            data-testid="correlation-rank-key-down"
            class="inline-flex items-center gap-1"
          >
            <span
              aria-hidden="true"
              class="inline-block h-2 w-2 rounded-sm"
              style={{ "background-color": CHART_NEGATIVE }}
            />
            fell
          </span>
          <span># = current rank · gold = top 3</span>
        </div>
      </div>

      <div class="flex min-w-0 flex-col gap-0.5 px-1 pb-1">
        <For each={rows()}>
          {(sector, index) => {
            const change = sector.rank_change_1m;
            const top3 = sector.rank_current <= 3;
            const positive = change > 0;
            const color = change === 0 ? TEXT_MUTED : positive ? CHART_POSITIVE : CHART_NEGATIVE;
            const width = () => barPct(change);
            return (
              <div
                data-testid={`correlation-rank-row-${index()}`}
                data-sector={sector.name}
                data-top3={String(top3)}
                data-change={change}
                class="grid min-w-0 grid-cols-[32px_minmax(64px,1fr)_minmax(0,1.4fr)] items-center gap-1 rounded-sm border border-transparent px-1 py-0.5 text-left"
                style={
                  top3
                    ? { "background-color": alpha(CHART_TOP3, 0.07) }
                    : undefined
                }
              >
                <span
                  data-testid={`correlation-rank-badge-${index()}`}
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
                <span class="relative h-4 min-w-0" aria-hidden="true">
                  <span
                    data-testid={`correlation-rank-rail-${index()}`}
                    class="absolute inset-y-0 left-1/2 w-px"
                    style={{ "background-color": alpha(TEXT_MUTED, 0.55) }}
                  />
                  <Show
                    when={change !== 0}
                    fallback={
                      <span
                        class="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
                        style={{ "background-color": TEXT_MUTED }}
                      />
                    }
                  >
                    <span
                      data-testid={`correlation-rank-bar-${index()}`}
                      class="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm"
                      style={{
                        left: positive ? "50%" : undefined,
                        right: positive ? undefined : "50%",
                        width: `${width()}%`,
                        "background-color": alpha(color, 0.85),
                      }}
                    />
                  </Show>
                  <span
                    data-testid={`correlation-rank-value-${index()}`}
                    class="absolute top-1/2 -translate-y-1/2 font-mono text-ui-micro tabular-nums"
                    style={{
                      color,
                      left: positive ? `calc(50% + ${width()}% + 4px)` : undefined,
                      right: positive ? undefined : `calc(50% + ${width()}% + 4px)`,
                    }}
                  >
                    {signed(change)}
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

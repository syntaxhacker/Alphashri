import { For, Show, createMemo } from "solid-js";
import { alpha, PRIMARY } from "@/ui/palette";
import type { RotationRow } from "@/types/rotation";
import {
  ROTATION_PERIODS,
  formatHeatReturn,
  returnHeat,
  sortRowsByPeriod,
} from "./returnVisuals";
import { useVerticalScrollCue } from "./useVerticalScrollCue";

const ROW_GRID =
  "grid grid-cols-[repeat(7,minmax(0,1fr))] items-center gap-x-[2px] gap-y-[2px] " +
  "sm:grid-cols-[minmax(96px,1.35fr)_repeat(7,minmax(0,1fr))]";

export interface MultiPeriodHeatmapProps {
  rows: RotationRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * DOM row heatmap: identity is the label column, magnitude is the tint, and
 * every period reads as a signed direct label — no axis, no legend, no table.
 */
export function MultiPeriodHeatmap(props: MultiPeriodHeatmapProps) {
  const sortedRows = createMemo(() => sortRowsByPeriod(props.rows, "1M"));
  const cue = useVerticalScrollCue();

  const select = (id: string) => props.onSelect(id);
  const onRowKeyDown = (event: KeyboardEvent, id: string) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    // Cancel the native button activation so the selection fires exactly once.
    event.preventDefault();
    select(id);
  };

  return (
    <div
      data-testid="rotation-matrix"
      class="relative flex h-full min-h-[260px] min-w-0 flex-1 flex-col overflow-hidden lg:min-h-0"
    >
      <div
        data-testid="rotation-matrix-header"
        class={`${ROW_GRID} shrink-0 border-b border-fin-border bg-fin-surface px-1 pb-[3px] pt-[2px]`}
      >
        <span class="col-span-7 text-ui-micro font-bold uppercase tracking-[0.4px] text-fin-text-muted sm:col-span-1">
          Group
        </span>
        <For each={ROTATION_PERIODS}>
          {(period) => (
            <span
              class={`flex items-center justify-center gap-[2px] text-ui-micro font-bold uppercase tracking-[0.4px] ${
                period === "1M" ? "text-fin-text" : "text-fin-text-muted"
              }`}
              title={period === "1M" ? "Sorted by 1M, high to low" : undefined}
            >
              {period}
              <Show when={period === "1M"}>
                <span aria-hidden="true" class="text-fin-primary">
                  ▾
                </span>
              </Show>
            </span>
          )}
        </For>
      </div>

      <div
        ref={cue.setRef}
        data-testid="rotation-matrix-rows"
        class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
      >
        <For each={sortedRows()}>
          {(row) => {
            const selected = () => row.id === props.selectedId;
            return (
              <button
                type="button"
                data-testid={`rotation-matrix-row-${row.id}`}
                data-active={selected() ? "true" : undefined}
                aria-pressed={selected()}
                onClick={() => select(row.id)}
                onKeyDown={(event) => onRowKeyDown(event, row.id)}
                class={`${ROW_GRID} w-full min-w-0 cursor-pointer border-0 border-b border-fin-border/50 bg-transparent px-1 py-[2px] text-left transition-colors last:border-b-0 hover:bg-fin-surface-alt focus-visible:bg-fin-surface-alt`}
                style={
                  selected()
                    ? {
                        "background-color": alpha(PRIMARY, 0.1),
                        "box-shadow": `inset 2px 0 0 ${PRIMARY}`,
                      }
                    : undefined
                }
              >
                <span
                  data-testid={`rotation-matrix-name-${row.id}`}
                  class="col-span-7 min-w-0 whitespace-normal break-words pr-1 text-ui-micro font-semibold leading-[1.2] text-fin-text sm:col-span-1"
                  title={row.name}
                >
                  {row.name}
                </span>
                <For each={ROTATION_PERIODS}>
                  {(period) => {
                    const value = row.returns[period];
                    const heat = returnHeat(value);
                    const label = formatHeatReturn(value);
                    return (
                      <span
                        data-testid={`rotation-matrix-cell-${row.id}-${period}`}
                        data-period={period}
                        data-value={value}
                        title={`${period} ${label}`}
                        class="flex h-[20px] min-w-0 items-center justify-center overflow-hidden rounded-[1px] font-mono text-ui-micro font-semibold tabular-nums"
                        style={{ "background-color": heat.fill, color: heat.ink }}
                      >
                        {label}
                      </span>
                    );
                  }}
                </For>
              </button>
            );
          }}
        </For>
        <Show when={sortedRows().length === 0}>
          <div class="px-2 py-3 text-center text-ui-micro text-fin-text-muted">No groups</div>
        </Show>
      </div>
      <Show when={cue.overflowing() && !cue.atEnd()}>
        <div
          data-testid="rotation-matrix-scroll-cue"
          aria-hidden="true"
          class="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center bg-gradient-to-t from-fin-bg via-fin-bg/90 to-transparent pb-0.5 pt-3 text-ui-micro font-semibold text-fin-text-muted"
        >
          Scroll ↓
        </div>
      </Show>
    </div>
  );
}

import { For, Show, createMemo } from "solid-js";
import { Text } from "@/ui";
import { alpha, CHART_TOP3, NEGATIVE, POSITIVE, PRIMARY } from "@/ui/palette";
import type { RotationPeriod, RotationRow } from "@/types/rotation";
import { ROTATION_STATUS_COLORS_BOARD, ROTATION_STATUS_LABELS } from "../rotationStatus";
import {
  finiteReturn,
  formatReturn,
  returnTone,
  signedBarScale,
  sortRowsByPeriod,
  type ReturnTone,
} from "./returnVisuals";
import { useVerticalScrollCue } from "./useVerticalScrollCue";

function deltaTone(delta: number): ReturnTone {
  if (!Number.isFinite(delta) || delta === 0) return "dimmed";
  return delta > 0 ? "success" : "error";
}

function breadthTone(breadth: number): ReturnTone {
  if (!Number.isFinite(breadth)) return "dimmed";
  if (breadth >= 55) return "success";
  if (breadth <= 45) return "error";
  return "dimmed";
}

function Micro(props: { label: string; value: string; tone: ReturnTone }) {
  return (
    <span class="inline-flex items-baseline gap-[3px] whitespace-nowrap">
      <span class="text-ui-micro text-fin-text-muted">{props.label}</span>
      <Text span c={props.tone} class="font-mono text-ui-micro font-semibold tabular-nums">
        {props.value}
      </Text>
    </span>
  );
}

function SignedBar(props: { value: number; maxAbs: number; testId: string }) {
  const scale = () => signedBarScale(props.value, props.maxAbs);
  return (
    <span
      data-testid={props.testId}
      data-value={props.value}
      data-negative={scale().negative ? "true" : "false"}
      data-zero={scale().zero ? "true" : "false"}
      data-width={scale().width}
      aria-hidden="true"
      class="relative block h-[6px] min-w-[52px] flex-1 overflow-hidden rounded-[2px] bg-fin-surface-alt"
    >
      <span class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-fin-border" />
      <Show when={!scale().zero}>
        <span
          class="absolute inset-y-0 rounded-[1px]"
          style={{
            left: scale().negative ? `${50 - scale().width}%` : "50%",
            width: `${scale().width}%`,
            "background-color": scale().negative ? NEGATIVE : POSITIVE,
          }}
        />
      </Show>
    </span>
  );
}

function Status(props: { row: RotationRow }) {
  const color = () => ROTATION_STATUS_COLORS_BOARD[props.row.status];
  return (
    <span class="inline-flex shrink-0 items-center gap-1">
      <span
        class="size-[5px] shrink-0 rounded-full"
        style={{ "background-color": color() }}
        aria-hidden="true"
      />
      <span class="text-ui-micro font-bold tracking-[0.3px]" style={{ color: color() }}>
        {ROTATION_STATUS_LABELS[props.row.status].short}
      </span>
    </span>
  );
}

export interface RankedBoardProps {
  rows: RotationRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  period: RotationPeriod;
}

/**
 * Ranked board: the selected period decides the order and the bar length, while
 * every supporting number is a direct label on the row — no header letters.
 */
export function RankedBoard(props: RankedBoardProps) {
  const sortedRows = createMemo(() => sortRowsByPeriod(props.rows, props.period));
  const maxAbs = createMemo(() =>
    Math.max(
      0,
      ...sortedRows().map((row) => Math.abs(finiteReturn(row.returns[props.period]) ?? 0)),
    ),
  );

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
      data-testid="rotation-board"
      data-period={props.period}
      class="relative flex h-full min-h-[300px] min-w-0 flex-1 flex-col overflow-hidden lg:min-h-0"
    >
      <div
        ref={cue.setRef}
        data-testid="rotation-board-scroller"
        class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
        style={{
          "scrollbar-width": "thin",
          "scrollbar-color": "var(--color-fin-border) transparent",
        }}
      >
        <For each={sortedRows()}>
          {(row, index) => {
            const rank = () => index() + 1;
            const selected = () => row.id === props.selectedId;
            const value = () => row.returns[props.period];
            const pnl = () => formatReturn(value(), 1);
            return (
              <button
                type="button"
                data-testid={`rotation-row-${row.id}`}
                data-active={selected() ? "true" : undefined}
                aria-pressed={selected()}
                onClick={() => select(row.id)}
                onKeyDown={(event) => onRowKeyDown(event, row.id)}
                class="grid w-full min-w-0 cursor-pointer grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-1.5 gap-y-[2px] border-0 border-b border-fin-border/50 bg-transparent px-1.5 py-[3px] text-left transition-colors last:border-b-0 hover:bg-fin-surface-alt focus-visible:bg-fin-surface-alt"
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
                  data-testid={`rotation-board-rank-${row.id}`}
                  data-rank={rank()}
                  class="row-span-2 self-center text-center font-mono text-ui-micro font-bold tabular-nums"
                  style={{ color: rank() <= 3 ? CHART_TOP3 : undefined }}
                >
                  {String(rank()).padStart(2, "0")}
                </span>

                <span class="flex min-w-0 items-center gap-1.5">
                  <span
                    class="min-w-0 truncate text-ui-micro font-semibold text-fin-text"
                    title={`${row.category || row.kind} · ${row.quadrant} · ${row.members} members`}
                  >
                    {row.name}
                  </span>
                  <Status row={row} />
                </span>

                <span class="flex min-w-0 items-baseline justify-end gap-1">
                  <span class="text-ui-micro font-semibold text-fin-text-muted">
                    {props.period}
                  </span>
                  <Text
                    span
                    c={returnTone(value())}
                    data-testid={`rotation-board-value-${row.id}`}
                    class="font-mono text-ui-body font-bold tabular-nums"
                  >
                    {pnl()}
                  </Text>
                </span>

                <span class="col-start-2 col-end-4 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-[2px]">
                  <SignedBar
                    value={Number.isFinite(value()) ? value() : 0}
                    maxAbs={maxAbs()}
                    testId={`rotation-board-bar-${row.id}`}
                  />
                  <Micro
                    label="1D"
                    value={formatReturn(row.returns["1D"], 1)}
                    tone={returnTone(row.returns["1D"])}
                  />
                  <Micro
                    label="1W"
                    value={formatReturn(row.returns["1W"], 1)}
                    tone={returnTone(row.returns["1W"])}
                  />
                  <Micro
                    label="1M"
                    value={formatReturn(row.returns["1M"], 1)}
                    tone={returnTone(row.returns["1M"])}
                  />
                  <Micro
                    label="RS"
                    value={Number.isFinite(row.rs_1m) ? row.rs_1m.toFixed(2) : "—"}
                    tone={returnTone(row.rs_1m)}
                  />
                  <Micro
                    label="rank"
                    value={
                      Number.isFinite(row.rank_delta)
                        ? `${row.rank_delta > 0 ? "+" : ""}${row.rank_delta}`
                        : "—"
                    }
                    tone={deltaTone(row.rank_delta)}
                  />
                  <Micro
                    label="breadth"
                    value={Number.isFinite(row.breadth) ? `${row.breadth.toFixed(0)}%` : "—"}
                    tone={breadthTone(row.breadth)}
                  />
                </span>
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
          data-testid="rotation-board-scroll-cue"
          aria-hidden="true"
          class="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center bg-gradient-to-t from-fin-bg via-fin-bg/90 to-transparent pb-0.5 pt-3 text-ui-micro font-semibold text-fin-text-muted"
        >
          Scroll ↓
        </div>
      </Show>
    </div>
  );
}

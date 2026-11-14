import { For, Show } from "solid-js";
import { Badge, Text } from "@/ui";
import { CompactPanel } from "@/components/common/compact";
import { LocalSymbolAvatar, LocalSparkline } from "./reportBits";
import { ReportPanelTitle } from "./reportCells";
import type { DailyMoveRow, DailyMovesPanelId } from "../../types/report";
import { formatCurrency, formatPercentage, getPnLTextColor } from "../../utils/ui-helpers";
import { symbolRowCursor, symbolRowProps } from "../../components/common/symbolRowProps";

const MOVE_PANELS: Array<{ id: DailyMovesPanelId; title: string }> = [
  { id: "gainers", title: "Top gainers" },
  { id: "losers", title: "Top losers" },
  { id: "volume_surge", title: "Volume surge" },
  { id: "gap_up", title: "Gap up" },
  { id: "gap_down", title: "Gap down" },
  { id: "range_expansion", title: "Range expansion" },
  { id: "new_52w_high", title: "New 52W high" },
  { id: "new_52w_low", title: "New 52W low" },
  { id: "turnover", title: "Turnover" },
];

/** Explicit `minmax(0,1fr)` tracks: a bare `1fr` floor is the content width, so
 *  one long symbol name widens the whole column past its panel. */
const PANEL_GRID_COLS = [
  "grid-cols-[repeat(1,minmax(0,1fr))]",
  "min-[600px]:grid-cols-[repeat(2,minmax(0,1fr))]",
  "min-[900px]:grid-cols-[repeat(3,minmax(0,1fr))]",
  "min-[1200px]:grid-cols-[repeat(4,minmax(0,1fr))]",
].join(" ");

function MoveRow(props: { row: DailyMoveRow; onOpenSymbol?: (symbol: string) => void }) {
  const row = () => props.row;
  const onOpenSymbol = () => props.onOpenSymbol;
  return (
    <div
      data-testid={`report-move-row-${row().symbol}`}
      data-symbol={row().symbol}
      {...symbolRowProps(onOpenSymbol(), row().symbol)}
      class={`flex items-center gap-1 min-w-0 py-1 px-2 border-b border-fin-border last:border-b-0 tabular-nums ${onOpenSymbol() ? "hover:bg-fin-surface-alt" : ""}`}
      style={{ cursor: symbolRowCursor(onOpenSymbol()) }}
    >
      <LocalSymbolAvatar symbol={row().symbol} name={row().name} logo={row().logo} size={20} />
      <div class="flex-1 min-w-0 flex flex-col gap-0">
        <Text size="xs" fw={700} truncate span title={row().symbol}>
          {row().symbol}
        </Text>
        <Show when={row().sub_value || row().sub_label}>
          <Text size="xs" c="dimmed" truncate span title={row().sub_label}>
            {row().sub_value || row().sub_label}
          </Text>
        </Show>
      </div>
      <div class="flex flex-col items-end shrink-0">
        <Text size="xs" ta="right" span className="font-mono tabular-nums">
          {formatCurrency(row().close, 2)}
        </Text>
        <Text
          size="xs"
          c={getPnLTextColor(row().change)}
          ta="right"
          span
          className="font-mono tabular-nums"
        >
          {formatPercentage(row().change)}
        </Text>
      </div>
      <LocalSparkline data={row().spark ?? []} change={row().change} width={64} height={20} />
    </div>
  );
}

interface ReportMovePanelsProps {
  moves: Partial<Record<DailyMovesPanelId, DailyMoveRow[]>> | null;
  onOpenSymbol?: (symbol: string) => void;
}

export function ReportMovePanels(props: ReportMovePanelsProps) {
  const moves = () => props.moves;
  const onOpenSymbol = () => props.onOpenSymbol;
  return (
    <div class={`grid ${PANEL_GRID_COLS} gap-0 min-w-0 w-full`}>
      <For each={MOVE_PANELS}>
        {(panel) => {
          const rows = () => moves()?.[panel.id] ?? [];
          return (
            <CompactPanel
              flush
              testId={`report-moves-${panel.id}`}
              title={
                <ReportPanelTitle testId={`report-moves-${panel.id}-title`}>
                  {panel.title}
                </ReportPanelTitle>
              }
              action={
                <Badge size="xs" data-testid={`report-moves-${panel.id}-count`}>
                  {rows().length}
                </Badge>
              }
            >
              <Show
                when={rows().length === 0}
                fallback={
                  <div data-testid={`report-moves-${panel.id}-rows`}>
                    <For each={rows()}>{(row) => <MoveRow row={row} onOpenSymbol={onOpenSymbol()} />}</For>
                  </div>
                }
              >
                <div class="px-2 py-1" data-testid={`report-moves-${panel.id}-empty`}>
                  <Text size="xs" c="dimmed">
                    No stocks qualify
                  </Text>
                </div>
              </Show>
            </CompactPanel>
          );
        }}
      </For>
    </div>
  );
}

import { For, Show } from "solid-js";
import { Box, Text } from "@/ui";
import type { InternalStockMover } from "./sectorUtils";
import { getPnLTextColor } from "../../utils/ui-helpers";
import { MONO } from "@/ui/palette";
import { displaySymbol } from "@/config/tvSymbols";
import { SymbolLink } from "../common/SymbolLink";
import { chartHrefForSymbol, useSymbolDock } from "../common/symbolDockContext";

// Decorated feed symbols (NSE:RELIANCE, BRK.B) need a canonical chart href;
// plain tickers render through the shared dock button.
function needsCanonicalLink(symbol: string): boolean {
  const raw = String(symbol ?? "").trim();
  return displaySymbol(raw) !== raw || raw.includes(".");
}

function pct(value: number): string {
  return `${value.toFixed(2)}%`;
}

const GRID_COLS = "grid grid-cols-[minmax(0,1fr)_44px_44px_52px] items-center gap-0.5 min-h-[18px] px-0.5 border-b border-fin-border";
const NUM_CELL = { "font-family": MONO, "font-variant-numeric": "tabular-nums" } as const;

export interface IntervalMoversTableProps {
  movers: InternalStockMover[];
  market?: string;
  onSymbolClick?: (symbol: string) => void;
}

export function IntervalMoversTable(props: IntervalMoversTableProps) {
  const movers = () => props.movers ?? [];
  const dock = useSymbolDock();
  const openSymbol = (symbol: string) =>
    props.onSymbolClick
      ? props.onSymbolClick(symbol)
      : dock.open(symbol, "chart", props.market);

  return (
    <Show
      when={movers().length > 0}
      fallback={
        <Box className="flex items-center justify-center p-1">
          <Text size="xs" c="dimmed" ta="center" py={1}>
            Collecting baseline for interval moves...
          </Text>
        </Box>
      }
    >
      <Box data-testid="interval-movers-table" className="flex flex-col">
        <Box className={GRID_COLS}>
          <For each={["Stock", "Prev", "Now", "Δ"]}>
            {(label, index) => (
              <Text
                c="dimmed"
                className="text-ui-micro font-bold tracking-[0.3px]"
                style={{ "text-align": index() === 0 ? "left" : "right" }}
              >
                {label}
              </Text>
            )}
          </For>
        </Box>
        <For each={movers()}>
          {(mover) => (
            <Box className="grid grid-cols-[minmax(0,1fr)_44px_44px_52px] items-center gap-0.5 min-h-5 px-0.5 border-b border-fin-border">
              {needsCanonicalLink(mover.symbol) ? (
                <Box
                  component="a"
                  href={chartHrefForSymbol(mover.symbol, props.market)}
                  className="min-w-0 text-fin-text no-underline hover:text-fin-primary"
                >
                  <Text truncate className="text-ui-micro font-semibold">
                    {displaySymbol(mover.symbol)}
                  </Text>
                </Box>
              ) : (
                <SymbolLink
                  symbol={mover.symbol}
                  inAppText
                  tvLink={false}
                  showChart={false}
                  showOptions={false}
                  size="xs"
                  weight={600}
                  testId={`interval-mover-${mover.symbol}`}
                  onTextClick={(sym) => openSymbol(sym)}
                  className="min-w-0 flex-1"
                />
              )}
              <Text c="dimmed" ta="right" className="text-ui-micro font-mono tabular-nums" style={NUM_CELL}>
                {pct(mover.prev_change)}
              </Text>
              <Text ta="right" className="text-ui-micro font-mono tabular-nums" style={NUM_CELL}>
                {pct(mover.change)}
              </Text>
              <Text
                c={getPnLTextColor(mover.delta)}
                fw={700}
                ta="right"
                className="text-ui-micro font-mono tabular-nums"
                style={NUM_CELL}
              >
                {mover.delta > 0 ? "+" : ""}
                {pct(mover.delta)}
              </Text>
            </Box>
          )}
        </For>
      </Box>
    </Show>
  );
}

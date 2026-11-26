import { For } from "solid-js";
import { Box, Text } from "@/ui";
import { IconX } from "@/components/common/Icons";
import type { PaperPosition } from "../../types/paperTrading";
import { formatPercentage, formatSignedPnl, getPnLTextColor } from "../../utils/ui-helpers";
import { ClickableSymbolSolid } from "./ClickableSymbolSolid";
import { displayOptionSymbol } from "./optionTradeUtils";
import { getPositionRowId } from "./positionId";

export interface PositionSelectHandler {
  (
    symbol: string,
    tradeId?: string,
    strategyName?: string,
    strategyType?: string,
    strategyId?: number,
    entryTime?: string,
  ): void;
}

export interface PositionNarrowCardsProps {
  positions: PaperPosition[];
  onSelect?: PositionSelectHandler;
  onClose?: (symbol: string, price: number) => void;
}

function numberOrDash(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";
}

function Field(props: { label: string; value: string; testId: string; tone?: string; emphasis?: boolean }) {
  return (
    <Box className="flex min-w-0 flex-col gap-0.5">
      <Text size="xs" c="dimmed" class="text-ui-micro uppercase tracking-wide">{props.label}</Text>
      <Text
        size={props.emphasis ? "md" : "xs"}
        fw={props.emphasis ? 700 : 500}
        c={props.tone}
        class="font-mono tabular-nums"
        data-testid={props.testId}
      >
        {props.value}
      </Text>
    </Box>
  );
}

/**
 * Phone-sized open positions. A desktop table keeps Entry→Curr and P&L off
 * screen at 390px, so each card carries the whole position in reading order:
 * symbol → qty → entry → LTP → P&L.
 */
export function PositionNarrowCards(props: PositionNarrowCardsProps) {
  return (
    <Box
      data-testid="positions-narrow-cards"
      role="list"
      aria-label="Open positions"
      class="flex min-h-0 min-w-0 flex-col gap-2 p-1"
    >
      <For each={props.positions}>
        {(pos) => {
          const rowId = () => getPositionRowId(pos);
          const hasPnl = () => typeof pos.pnl === "number" && Number.isFinite(pos.pnl);
          return (
            <Box
              data-testid={`position-row-${rowId()}`}
              role="listitem"
              class="shrink-0 rounded border border-fin-border bg-fin-surface p-2"
            >
              <Box class="flex min-w-0 items-center justify-between gap-2">
                <Box class="flex min-w-0 items-center gap-2">
                  <ClickableSymbolSolid
                    symbol={pos.symbol}
                    testId={`symbol-link-${rowId()}`}
                    onClick={() => props.onSelect?.(
                      pos.symbol,
                      pos.order_id,
                      pos.strategy_name,
                      pos.strategy_type,
                      pos.strategy_id,
                      pos.entry_time,
                    )}
                  />
                  <Text size="xs" c="dimmed" class="truncate">{pos.strategy_name}</Text>
                </Box>
                <button
                  type="button"
                  class="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-transparent text-fin-negative"
                  title="Close position"
                  aria-label={`Close position ${displayOptionSymbol(pos.symbol)}`}
                  data-testid={`close-position-${rowId()}`}
                  onClick={() => props.onClose?.(pos.symbol, pos.current_price)}
                >
                  <IconX size={14} />
                </button>
              </Box>
              <Box class="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-2">
                <Field label="Qty" value={Number.isFinite(pos.quantity) ? String(pos.quantity) : "—"} testId={`position-narrow-qty-${rowId()}`} />
                <Field label="Entry" value={numberOrDash(pos.entry_price) === "—" ? "—" : `₹${numberOrDash(pos.entry_price)}`} testId={`position-narrow-entry-${rowId()}`} />
                <Field label="LTP" value={numberOrDash(pos.current_price) === "—" ? "—" : `₹${numberOrDash(pos.current_price)}`} testId={`position-narrow-ltp-${rowId()}`} />
                <Field
                  label="P&L"
                  value={hasPnl()
                    ? `${formatSignedPnl(pos.pnl)} (${formatPercentage(pos.pnl_pct, 2, false)})`
                    : "—"}
                  tone={hasPnl() ? getPnLTextColor(pos.pnl) : undefined}
                  testId={`position-narrow-pnl-${rowId()}`}
                  emphasis
                />
              </Box>
            </Box>
          );
        }}
      </For>
    </Box>
  );
}

import { Show } from "solid-js";
import { Text, Button, Tooltip } from "@/ui";
import { IconX } from "@/components/common/Icons";
import type { PaperPosition } from "../../types/paperTrading";
import { formatNumber, getPnLTextColor } from "../../utils/ui-helpers";
import { alpha } from "@/ui/alpha";
import * as palette from "@/ui/palette";

interface SelectedPositionBarProps {
  position: PaperPosition | null;
  onClose?: (symbol: string, price: number) => void;
}

export function SelectedPositionBar(props: SelectedPositionBarProps) {
  const sideColor = () => props.position?.side === "BUY" ? "success" : "error";
  const bgTint = () => props.position ? (props.position.pnl >= 0 ? alpha(palette.POSITIVE, 0.06) : alpha(palette.NEGATIVE, 0.06)) : "transparent";

  return (
    <Show
      when={props.position}
      fallback={
        <div class="paper-selected-bar paper-selected-bar-empty flex items-center px-2 py-1 bg-fin-bg border-0 border-t border-fin-border rounded-b-fin" id="paper-selected-bar-empty">
          <Text className="paper-selected-bar-empty-text" size="xs" c="dimmed">No position selected — click a row to view details</Text>
        </div>
      }
    >
      {(position) => {
        const pos = position();
        return (
          <div class="paper-selected-bar flex items-center justify-between flex-wrap gap-2 px-2 py-1 border-t border-fin-border rounded-b-fin" id={`paper-selected-bar-${pos.symbol}`} style={{ "background-color": bgTint() }}>
            <div class="paper-selected-bar-main flex items-center gap-4 flex-wrap">
              <Text className="paper-selected-bar-symbol font-mono tabular-nums" id={`paper-selected-bar-symbol-${pos.symbol}`} size="sm" fw={600}>
                {pos.symbol}
              </Text>
              <div class="paper-selected-bar-side flex items-center px-2 py-1 rounded-[1px]" style={{ "background-color": alpha(pos.side === "BUY" ? palette.POSITIVE : palette.NEGATIVE, 0.08) }}>
                <Text className="paper-selected-bar-side-text" size="xs" fw={600} c={sideColor()}>
                  {pos.side}
                </Text>
              </div>
              <Text className="paper-selected-bar-qty font-mono tabular-nums" size="xs" c="dimmed">Qty <Text span fw={500}>{pos.quantity}</Text></Text>
              <div class="paper-selected-bar-entry flex items-center gap-1">
                <Text className="paper-selected-bar-label" size="xs" c="dimmed">Entry</Text>
                <Text className="paper-selected-bar-value font-mono tabular-nums" size="xs" fw={500}>₹{pos.entry_price.toFixed(2)}</Text>
              </div>
              <div class="paper-selected-bar-curr flex items-center gap-1">
                <Text className="paper-selected-bar-label" size="xs" c="dimmed">Curr</Text>
                <Text className="paper-selected-bar-value font-mono tabular-nums" size="xs" fw={500}>₹{pos.current_price.toFixed(2)}</Text>
              </div>
              <div class="paper-selected-bar-pnl flex items-center px-2 py-1 rounded-[1px]" style={{ "background-color": alpha(pos.pnl >= 0 ? palette.POSITIVE : palette.NEGATIVE, 0.1) }}>
                <Text className="paper-selected-bar-pnl-text font-mono tabular-nums" size="xs" c={getPnLTextColor(pos.pnl)} fw={700}>
                  {pos.pnl >= 0 ? "+" : ""}₹{formatNumber(pos.pnl)} ({pos.pnl_pct.toFixed(2)}%)
                </Text>
              </div>
              <div class="paper-selected-bar-tp flex items-center gap-1">
                <Text className="paper-selected-bar-label" size="xs" c="dimmed">TP</Text>
                <Text className="paper-selected-bar-value font-mono tabular-nums" size="xs" c="success" fw={500}>{pos.take_profit > 0 ? `₹${pos.take_profit.toFixed(2)}` : "—"}</Text>
              </div>
              <div class="paper-selected-bar-sl flex items-center gap-1">
                <Text className="paper-selected-bar-label" size="xs" c="dimmed">SL</Text>
                <Text className="paper-selected-bar-value font-mono tabular-nums" size="xs" c="error" fw={500}>{pos.stop_loss > 0 ? `₹${pos.stop_loss.toFixed(2)}` : "—"}</Text>
              </div>
            </div>
            <Show when={props.onClose}>
              {(onClose) => {
                const close = onClose();
                return (
                  <Tooltip label="Close position">
                    <Button
                      className="paper-selected-bar-close"
                      size="xs"
                      variant="filled"
                      color="error"
                      leftSection={<IconX size={12} />}
                      onClick={() => close(pos.symbol, pos.current_price)}
                      data-testid="close-selected-position"
                    >
                      Close
                    </Button>
                  </Tooltip>
                );
              }}
            </Show>
          </div>
        );
      }}
    </Show>
  );
}

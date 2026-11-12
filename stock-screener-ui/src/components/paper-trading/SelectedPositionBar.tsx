import { memo } from "react";
import { Text, Button, Tooltip } from "@/ui";
import { IconX } from "@tabler/icons-react";
import type { PaperPosition } from "../../types/paperTrading";
import { formatNumber, getPnLTextColor } from "../../utils/ui-helpers";
import { alpha } from "@/ui/alpha";
import * as palette from "@/ui/palette";

interface SelectedPositionBarProps {
  position: PaperPosition | null;
  onClose?: (symbol: string, price: number) => void;
}

export const SelectedPositionBar = memo(function SelectedPositionBar({ position, onClose }: SelectedPositionBarProps) {
  if (!position) {
    return (
      <div className="paper-selected-bar paper-selected-bar-empty flex items-center px-2 py-1 bg-fin-bg border-0 border-t border-fin-border rounded-b-fin" id="paper-selected-bar-empty">
        <Text className="paper-selected-bar-empty-text" size="xs" c="dimmed">No position selected — click a row to view details</Text>
      </div>
    );
  }

  const sideColor = position.side === "BUY" ? "success" : "error";
  const bgTint = position.pnl >= 0 ? alpha(palette.POSITIVE, 0.06) : alpha(palette.NEGATIVE, 0.06);

  return (
    <div className="paper-selected-bar flex items-center justify-between flex-wrap gap-2 px-2 py-1 border-t border-fin-border rounded-b-fin" id={`paper-selected-bar-${position.symbol}`} style={{ "background-color": bgTint }}>
      <div className="paper-selected-bar-main flex items-center gap-4 flex-wrap">
        <Text className="paper-selected-bar-symbol" id={`paper-selected-bar-symbol-${position.symbol}`} size="sm" fw={600}>
          {position.symbol}
        </Text>
        <div className="paper-selected-bar-side flex items-center px-2 py-1 rounded-[1px]" style={{ "background-color": alpha(position.side === "BUY" ? palette.POSITIVE : palette.NEGATIVE, 0.08) }}>
          <Text className="paper-selected-bar-side-text" size="xs" fw={600} c={sideColor}>
            {position.side}
          </Text>
        </div>
        <Text className="paper-selected-bar-qty" size="xs" c="dimmed">Qty <Text span fw={500}>{position.quantity}</Text></Text>
        <div className="paper-selected-bar-entry flex items-center gap-1">
          <Text className="paper-selected-bar-label" size="xs" c="dimmed">Entry</Text>
          <Text className="paper-selected-bar-value" size="xs" fw={500}>₹{position.entry_price.toFixed(2)}</Text>
        </div>
        <div className="paper-selected-bar-curr flex items-center gap-1">
          <Text className="paper-selected-bar-label" size="xs" c="dimmed">Curr</Text>
          <Text className="paper-selected-bar-value" size="xs" fw={500}>₹{position.current_price.toFixed(2)}</Text>
        </div>
        <div className="paper-selected-bar-pnl flex items-center px-2 py-1 rounded-[1px]" style={{ "background-color": alpha(position.pnl >= 0 ? palette.POSITIVE : palette.NEGATIVE, 0.1) }}>
          <Text className="paper-selected-bar-pnl-text" size="xs" c={getPnLTextColor(position.pnl)} fw={700}>
            {position.pnl >= 0 ? "+" : ""}₹{formatNumber(position.pnl)} ({position.pnl_pct.toFixed(2)}%)
          </Text>
        </div>
        <div className="paper-selected-bar-tp flex items-center gap-1">
          <Text className="paper-selected-bar-label" size="xs" c="dimmed">TP</Text>
          <Text className="paper-selected-bar-value" size="xs" c="success" fw={500}>{position.take_profit > 0 ? `₹${position.take_profit.toFixed(2)}` : "—"}</Text>
        </div>
        <div className="paper-selected-bar-sl flex items-center gap-1">
          <Text className="paper-selected-bar-label" size="xs" c="dimmed">SL</Text>
          <Text className="paper-selected-bar-value" size="xs" c="error" fw={500}>{position.stop_loss > 0 ? `₹${position.stop_loss.toFixed(2)}` : "—"}</Text>
        </div>
      </div>
      {onClose && (
        <Tooltip label="Close position">
          <Button
            className="paper-selected-bar-close"
            size="xs"
            variant="filled"
            color="error"
            leftSection={<IconX size={12} />}
            onClick={() => onClose(position.symbol, position.current_price)}
            data-testid="close-selected-position"
          >
            Close
          </Button>
        </Tooltip>
      )}
    </div>
  );
});

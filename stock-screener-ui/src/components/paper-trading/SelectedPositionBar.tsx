import { memo } from "react";
import { Text, Button, Tooltip } from "@/ui";
import MuiBox from "@mui/material/Box";
import { alpha } from "@mui/material/styles";
import { useTheme } from "@mui/material/styles";
import { IconX } from "@tabler/icons-react";
import type { PaperPosition } from "../../types/paperTrading";
import { formatNumber, getPnLTextColor } from "../../utils/ui-helpers";

interface SelectedPositionBarProps {
  position: PaperPosition | null;
  onClose?: (symbol: string, price: number) => void;
}

export const SelectedPositionBar = memo(function SelectedPositionBar({ position, onClose }: SelectedPositionBarProps) {
  const theme = useTheme();
  if (!position) {
    return (
      <MuiBox
        className="paper-selected-bar paper-selected-bar-empty"
        id="paper-selected-bar-empty"
        sx={{
          display: "flex",
          alignItems: "center",
          px: 1,
          py: 0.5,
          background: theme.palette.background.paper,
          border: 0,
          borderTop: `1px solid ${theme.palette.divider}`,
          borderBottomLeftRadius: Number(theme.shape.borderRadius),
          borderBottomRightRadius: Number(theme.shape.borderRadius),
        }}
      >
        <Text className="paper-selected-bar-empty-text" size="xs" c="dimmed">No position selected — click a row to view details</Text>
      </MuiBox>
    );
  }

  const sideColor = position.side === "BUY" ? "success" : "error";
  const bgTint = position.pnl >= 0 ? alpha(theme.palette.success.main, 0.06) : alpha(theme.palette.error.main, 0.06);

  return (
    <MuiBox
      className="paper-selected-bar"
      id={`paper-selected-bar-${position.symbol}`}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 1,
        px: 1,
        py: 0.5,
        background: bgTint,
        borderTop: `1px solid ${theme.palette.divider}`,
        borderBottomLeftRadius: Number(theme.shape.borderRadius),
        borderBottomRightRadius: Number(theme.shape.borderRadius),
      }}
    >
      <MuiBox className="paper-selected-bar-main" sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
        <Text className="paper-selected-bar-symbol" id={`paper-selected-bar-symbol-${position.symbol}`} size="sm" fw={600}>{position.symbol}</Text>
        <MuiBox
          className="paper-selected-bar-side"
          sx={{ display: "flex", alignItems: "center", px: 1, py: 0.5, borderRadius: 1, backgroundColor: alpha(position.side === "BUY" ? theme.palette.success.main : theme.palette.error.main, 0.08) }}
        >
          <Text className="paper-selected-bar-side-text" size="xs" fw={600} c={`${sideColor}.8`}>{position.side}</Text>
        </MuiBox>
        <Text className="paper-selected-bar-qty" size="xs" c="dimmed">Qty <Text span fw={500}>{position.quantity}</Text></Text>
        <MuiBox className="paper-selected-bar-entry" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Text className="paper-selected-bar-label" size="xs" c="dimmed">Entry</Text>
          <Text className="paper-selected-bar-value" size="xs" fw={500}>₹{position.entry_price.toFixed(2)}</Text>
        </MuiBox>
        <MuiBox className="paper-selected-bar-curr" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Text className="paper-selected-bar-label" size="xs" c="dimmed">Curr</Text>
          <Text className="paper-selected-bar-value" size="xs" fw={500}>₹{position.current_price.toFixed(2)}</Text>
        </MuiBox>
        <MuiBox
          className="paper-selected-bar-pnl"
          sx={{ display: "flex", alignItems: "center", px: 1, py: 0.5, borderRadius: 1, backgroundColor: alpha(position.pnl >= 0 ? theme.palette.success.main : theme.palette.error.main, 0.1) }}
        >
          <Text className="paper-selected-bar-pnl-text" size="xs" c={getPnLTextColor(position.pnl)} fw={700}>
            {position.pnl >= 0 ? "+" : ""}₹{formatNumber(position.pnl)} ({position.pnl_pct.toFixed(2)}%)
          </Text>
        </MuiBox>
        <MuiBox className="paper-selected-bar-tp" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Text className="paper-selected-bar-label" size="xs" c="dimmed">TP</Text>
          <Text className="paper-selected-bar-value" size="xs" c="success" fw={500}>{position.take_profit > 0 ? `₹${position.take_profit.toFixed(2)}` : "—"}</Text>
        </MuiBox>
        <MuiBox className="paper-selected-bar-sl" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Text className="paper-selected-bar-label" size="xs" c="dimmed">SL</Text>
          <Text className="paper-selected-bar-value" size="xs" c="error" fw={500}>{position.stop_loss > 0 ? `₹${position.stop_loss.toFixed(2)}` : "—"}</Text>
        </MuiBox>
      </MuiBox>
      {onClose && (
        <Tooltip label="Close position">
          <Button
            className="paper-selected-bar-close"
            size="compact-xs"
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
    </MuiBox>
  );
});



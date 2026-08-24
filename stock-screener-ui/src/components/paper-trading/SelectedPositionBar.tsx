import { memo } from "react";
import { Text, Button, Tooltip } from "@/ui";
import MuiBox from "@mui/material/Box";
import { IconX } from "@tabler/icons-react";
import type { PaperPosition } from "../../types/paperTrading";
import { formatNumber, getPnLTextColor } from "../../utils/ui-helpers";
import { POSITIVE, NEGATIVE } from "../../config/colors";

function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const TINT_POSITIVE = withAlpha(POSITIVE, 0.06);
const TINT_NEGATIVE = withAlpha(NEGATIVE, 0.06);

interface SelectedPositionBarProps {
  position: PaperPosition | null;
  onClose?: (symbol: string, price: number) => void;
}

export const SelectedPositionBar = memo(function SelectedPositionBar({ position, onClose }: SelectedPositionBarProps) {
  if (!position) {
    return (
      <MuiBox
        sx={(theme) => ({
          display: "flex",
          alignItems: "center",
          px: 1,
          py: 0.5,
          background: theme.palette.background.paper,
        })}
      >
        <Text size="xs" c="dimmed">No position selected — click a row to view details</Text>
      </MuiBox>
    );
  }

  const sideColor = position.side === "BUY" ? "teal" : "red";
  const bgTint = position.pnl >= 0 ? TINT_POSITIVE : TINT_NEGATIVE;

  return (
    <MuiBox
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 1,
        px: 1,
        py: 0.5,
        background: bgTint,
      }}
    >
      <MuiBox sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
        <Text size="sm" fw={600}>{position.symbol}</Text>
        <MuiBox
          sx={(theme) => ({ display: "flex", alignItems: "center", px: 1, py: 0.5, borderRadius: 1, backgroundColor: withAlpha(position.side === "BUY" ? theme.palette.success.main : theme.palette.error.main, 0.08) })}
        >
          <Text size="xs" fw={600} c={`${sideColor}.8`}>{position.side}</Text>
        </MuiBox>
        <Text size="xs" c="dimmed">Qty <Text span fw={500}>{position.quantity}</Text></Text>
        <MuiBox sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Text size="xs" c="dimmed">Entry</Text>
          <Text size="xs" fw={500}>₹{position.entry_price.toFixed(2)}</Text>
        </MuiBox>
        <MuiBox sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Text size="xs" c="dimmed">Curr</Text>
          <Text size="xs" fw={500}>₹{position.current_price.toFixed(2)}</Text>
        </MuiBox>
        <MuiBox
          sx={{ display: "flex", alignItems: "center", px: 1, py: 0.5, borderRadius: 1, backgroundColor: withAlpha(position.pnl >= 0 ? POSITIVE : NEGATIVE, 0.1) }}
        >
          <Text size="xs" c={getPnLTextColor(position.pnl)} fw={700}>
            {position.pnl >= 0 ? "+" : ""}₹{formatNumber(position.pnl)} ({position.pnl_pct.toFixed(2)}%)
          </Text>
        </MuiBox>
        <MuiBox sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Text size="xs" c="dimmed">TP</Text>
          <Text size="xs" c="teal" fw={500}>{position.take_profit > 0 ? `₹${position.take_profit.toFixed(2)}` : "—"}</Text>
        </MuiBox>
        <MuiBox sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Text size="xs" c="dimmed">SL</Text>
          <Text size="xs" c="red" fw={500}>{position.stop_loss > 0 ? `₹${position.stop_loss.toFixed(2)}` : "—"}</Text>
        </MuiBox>
      </MuiBox>
      {onClose && (
        <Tooltip label="Close position">
          <Button
            size="compact-xs"
            variant="light"
            color="red"
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



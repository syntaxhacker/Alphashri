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
        sx={{
          display: "flex",
          alignItems: "center",
          px: 1,
          py: 0.5,
          background: theme.palette.background.paper,
        }}
      >
        <Text size="xs" c="dimmed">No position selected — click a row to view details</Text>
      </MuiBox>
    );
  }

  const sideColor = position.side === "BUY" ? "info" : "error";
  const bgTint = position.pnl >= 0 ? alpha(theme.palette.success.main, 0.06) : alpha(theme.palette.error.main, 0.06);

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
          sx={{ display: "flex", alignItems: "center", px: 1, py: 0.5, borderRadius: 1, backgroundColor: alpha(position.side === "BUY" ? theme.palette.success.main : theme.palette.error.main, 0.08) }}
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
          sx={{ display: "flex", alignItems: "center", px: 1, py: 0.5, borderRadius: 1, backgroundColor: alpha(position.pnl >= 0 ? theme.palette.success.main : theme.palette.error.main, 0.1) }}
        >
          <Text size="xs" c={getPnLTextColor(position.pnl)} fw={700}>
            {position.pnl >= 0 ? "+" : ""}₹{formatNumber(position.pnl)} ({position.pnl_pct.toFixed(2)}%)
          </Text>
        </MuiBox>
        <MuiBox sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Text size="xs" c="dimmed">TP</Text>
          <Text size="xs" c="success" fw={500}>{position.take_profit > 0 ? `₹${position.take_profit.toFixed(2)}` : "—"}</Text>
        </MuiBox>
        <MuiBox sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Text size="xs" c="dimmed">SL</Text>
          <Text size="xs" c="error" fw={500}>{position.stop_loss > 0 ? `₹${position.stop_loss.toFixed(2)}` : "—"}</Text>
        </MuiBox>
      </MuiBox>
      {onClose && (
        <Tooltip label="Close position">
          <Button
            size="compact-xs"
            variant="light"
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



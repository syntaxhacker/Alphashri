import { Text, Group, Button, Tooltip } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import type { PaperPosition } from "../../types/paperTrading";
import { formatNumber, getPnLTextColor } from "../../utils/ui-helpers";

interface SelectedPositionBarProps {
  position: PaperPosition | null;
  onClose?: (symbol: string, price: number) => void;
}

export function SelectedPositionBar({ position, onClose }: SelectedPositionBarProps) {
  if (!position) {
    return (
      <Group
        px="xs"
        py={4}
        style={{
          borderTop: "1px solid var(--mantine-color-default-border)",
          background: "var(--mantine-color-body)",
        }}
      >
        <Text size="xs" c="dimmed">No position selected — click a row to view details</Text>
      </Group>
    );
  }

  const sideColor = position.side === "BUY" ? "teal" : "red";

  return (
    <Group
      px="xs"
      py={4}
      justify="space-between"
      style={{
        borderTop: "1px solid var(--mantine-color-default-border)",
        background: "var(--mantine-color-body)",
      }}
    >
      <Group gap="md">
        <Text size="sm" fw={600}>{position.symbol}</Text>
        <Badge size="xs" color={sideColor}>{position.side}</Badge>
        <Text size="xs" c="dimmed">Qty {position.quantity}</Text>
        <Group gap={4}>
          <Text size="xs" c="dimmed">Entry</Text>
          <Text size="xs">₹{position.entry_price.toFixed(2)}</Text>
        </Group>
        <Group gap={4}>
          <Text size="xs" c="dimmed">Curr</Text>
          <Text size="xs">₹{position.current_price.toFixed(2)}</Text>
        </Group>
        <Text size="xs" c={getPnLTextColor(position.pnl)} fw={600}>
          {position.pnl >= 0 ? "+" : ""}₹{formatNumber(position.pnl)} ({position.pnl_pct.toFixed(2)}%)
        </Text>
        <Group gap={4}>
          <Text size="xs" c="dimmed">TP</Text>
          <Text size="xs" c="teal">{position.take_profit > 0 ? `₹${position.take_profit.toFixed(2)}` : "—"}</Text>
        </Group>
        <Group gap={4}>
          <Text size="xs" c="dimmed">SL</Text>
          <Text size="xs" c="red">{position.stop_loss > 0 ? `₹${position.stop_loss.toFixed(2)}` : "—"}</Text>
        </Group>
      </Group>
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
    </Group>
  );
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <Text
      component="span"
      size="xs"
      fw={600}
      style={{ color: `var(--mantine-color-${color}-6)` }}
    >
      {children}
    </Text>
  );
}

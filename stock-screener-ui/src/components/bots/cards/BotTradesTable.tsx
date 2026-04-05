import { Card, Text, Badge, Group, Table, ActionIcon, Box } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import type { BotTrade } from "../../../types/bots";
import { formatNumber as formatNumberShared, getPnLTextColor } from "../../../utils/ui-helpers";
import { SideBadge, ExitReasonBadge } from "../../common/BadgeComponents";

export function TradesTable({ trades, onRefresh }: { trades: BotTrade[]; onRefresh: () => void }) {
  if (trades.length === 0) {
    return (
      <Card shadow="sm" padding="md" radius="md" withBorder data-testid="bot-trades">
        <Text fw={600} mb="sm">
          Trade History
        </Text>
        <Text c="dimmed" ta="center">
          No trades yet
        </Text>
      </Card>
    );
  }

  return (
    <Card shadow="sm" padding="md" radius="md" withBorder data-testid="bot-trades">
      <Group justify="space-between" mb="sm">
        <Text fw={600}>Trade History ({trades.length})</Text>
        <ActionIcon
          variant="subtle"
          onClick={onRefresh}
          title="Refresh trades"
          data-testid="refresh-trades-btn"
        >
          <IconRefresh size={16} />
        </ActionIcon>
      </Group>
      <Box style={{ overflowX: "auto" }}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Strategy</Table.Th>
              <Table.Th>Symbol</Table.Th>
              <Table.Th>Side</Table.Th>
              <Table.Th>Qty</Table.Th>
              <Table.Th>Entry</Table.Th>
              <Table.Th>Exit</Table.Th>
              <Table.Th>P&L</Table.Th>
              <Table.Th>Net P&L</Table.Th>
              <Table.Th>Exit Reason</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {trades.map((t, idx) => {
              const pnlColor = getPnLTextColor(t.pnl);
              const netPnlColor = getPnLTextColor(t.net_pnl);

              return (
                <Table.Tr key={idx} bg={t.is_test ? "rgba(255, 193, 7, 0.1)" : undefined}>
                  <Table.Td>
                    <Group gap="xs">
                      <Text size="sm">{t.strategy_name}</Text>
                      {t.is_test && (
                        <Badge color="yellow" size="sm" variant="light">
                          TEST
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text fw={600}>{t.symbol}</Text>
                  </Table.Td>
                  <Table.Td>
                    <SideBadge side={t.side} />
                  </Table.Td>
                  <Table.Td>{t.quantity}</Table.Td>
                  <Table.Td>₹{t.entry_price.toFixed(2)}</Table.Td>
                  <Table.Td>₹{t.exit_price?.toFixed(2) || "-"}</Table.Td>
                  <Table.Td>
                    <Text c={pnlColor} fw={600}>
                      {t.pnl >= 0 ? "+" : ""}₹{formatNumberShared(t.pnl)}
                      <Text span size="sm" ml={4}>
                        ({t.pnl_pct >= 0 ? "+" : ""}
                        {t.pnl_pct.toFixed(2)}%)
                      </Text>
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text c={netPnlColor} fw={600}>
                      {t.net_pnl >= 0 ? "+" : ""}₹{formatNumberShared(t.net_pnl)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <ExitReasonBadge reason={t.exit_reason} />
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Box>
    </Card>
  );
}

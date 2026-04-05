import { Card, Text, Table } from "@mantine/core";
import type { BotPosition } from "../../../types/bots";
import { formatNumber as formatNumberShared, getPnLTextColor } from "../../../utils/ui-helpers";
import { SideBadge } from "../../common/BadgeComponents";

export function PositionsTable({ positions }: { positions: BotPosition[] }) {
  if (positions.length === 0) return null;

  return (
    <Card shadow="sm" padding="md" radius="md" withBorder data-testid="bot-positions">
      <Text fw={600} mb="sm">
        Open Positions
      </Text>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Strategy</Table.Th>
            <Table.Th>Symbol</Table.Th>
            <Table.Th>Side</Table.Th>
            <Table.Th>Qty</Table.Th>
            <Table.Th>Entry</Table.Th>
            <Table.Th>Current</Table.Th>
            <Table.Th>P&L</Table.Th>
            <Table.Th>SL/TP</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {positions.map((p, idx) => {
            const pnlColor = getPnLTextColor(p.unrealized_pnl);
            return (
              <Table.Tr key={idx}>
                <Table.Td>{p.strategy_name}</Table.Td>
                <Table.Td>
                  <Text fw={600}>{p.symbol}</Text>
                </Table.Td>
                <Table.Td>
                  <SideBadge side={p.side} />
                </Table.Td>
                <Table.Td>{p.quantity}</Table.Td>
                <Table.Td>₹{p.entry_price.toFixed(2)}</Table.Td>
                <Table.Td>₹{p.current_price.toFixed(2)}</Table.Td>
                <Table.Td>
                  <Text c={pnlColor} fw={600}>
                    {p.unrealized_pnl >= 0 ? "+" : ""}₹{formatNumberShared(p.unrealized_pnl)}
                    <Text span size="sm" ml={4}>
                      ({p.unrealized_pnl_pct >= 0 ? "+" : ""}
                      {p.unrealized_pnl_pct.toFixed(2)}%)
                    </Text>
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    SL: ₹{p.stop_loss.toFixed(2)}
                    <br />
                    TP: ₹{p.take_profit.toFixed(2)}
                  </Text>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

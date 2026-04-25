import { Table, Text } from "@mantine/core";
import { CompactPanel } from "../common/compact";
import { getPnLTextColor } from "../../utils/ui-helpers";
import type { ReplaySummary } from "../../types/replay";

interface ReplaySummaryProps {
  summary: ReplaySummary | null;
}

export function ReplaySummaryPanel({ summary }: ReplaySummaryProps) {
  if (!summary) return null;

  const breakdown = summary.strategy_breakdown || {};
  const entries = Object.entries(breakdown);

  return (
    <CompactPanel title="Per-Strategy Breakdown" data-testid="replay-summary">
      <Table striped highlightOnHover size="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Strategy</Table.Th>
            <Table.Th ta="right">Trades</Table.Th>
            <Table.Th ta="right">Win Rate</Table.Th>
            <Table.Th ta="right">Net P&L</Table.Th>
            <Table.Th ta="right">PF</Table.Th>
            <Table.Th ta="right">Min RR</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {entries.map(([name, s]) => (
            <Table.Tr key={name}>
              <Table.Td>
                <Text size="xs" fw={500}>
                  {name}
                </Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="xs">{s.trades}</Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="xs">{s.win_rate.toFixed(1)}%</Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="xs" fw={500} c={getPnLTextColor(s.net_pnl)}>
                  {s.net_pnl >= 0 ? "+" : ""}
                  {s.net_pnl.toFixed(2)}
                </Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text
                  size="xs"
                  c={
                    s.profit_factor != null && s.profit_factor > 1
                      ? "green"
                      : s.profit_factor != null && s.profit_factor < 1
                        ? "red"
                        : "dimmed"
                  }
                >
                  {s.profit_factor != null ? s.profit_factor.toFixed(2) : "N/A"}
                </Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="xs">{s.min_rr_ratio}x</Text>
              </Table.Td>
            </Table.Tr>
          ))}
          <Table.Tr style={{ borderTop: "2px solid var(--mantine-color-gray-4)" }}>
            <Table.Td>
              <Text size="xs" fw={700}>
                Total
              </Text>
            </Table.Td>
            <Table.Td ta="right">
              <Text size="xs" fw={700}>
                {summary.total_trades}
              </Text>
            </Table.Td>
            <Table.Td ta="right">
              <Text size="xs" fw={700}>
                {summary.win_rate.toFixed(1)}%
              </Text>
            </Table.Td>
            <Table.Td ta="right">
              <Text size="xs" fw={700} c={getPnLTextColor(summary.net_pnl)}>
                {summary.net_pnl >= 0 ? "+" : ""}
                {summary.net_pnl.toFixed(2)}
              </Text>
            </Table.Td>
            <Table.Td ta="right">
              <Text
                size="xs"
                fw={700}
                c={
                  summary.profit_factor != null && summary.profit_factor > 1
                    ? "green"
                    : summary.profit_factor != null && summary.profit_factor < 1
                      ? "red"
                      : "dimmed"
                }
              >
                {summary.profit_factor != null ? summary.profit_factor.toFixed(2) : "N/A"}
              </Text>
            </Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
    </CompactPanel>
  );
}

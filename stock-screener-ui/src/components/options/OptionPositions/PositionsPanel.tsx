import { Table, Text, Stack, Badge, Paper, Alert } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";

interface Position {
  instrument_key: string;
  trading_symbol: string;
  option_type: string;
  strike_price: number;
  quantity: number;
  average_price: number;
  current_price?: number;
  pnl?: number;
}

interface PositionsPanelProps {
  positions: Position[];
  loading?: boolean;
  error?: string | null;
}

export function PositionsPanel({ positions = [], loading, error }: PositionsPanelProps) {
  if (loading) {
    return (
      <Stack gap="md">
        <Text size="lg" fw={600}>
          Positions
        </Text>
        <Text c="dimmed">Loading positions...</Text>
      </Stack>
    );
  }

  if (error) {
    return (
      <Stack gap="md">
        <Text size="lg" fw={600}>
          Positions
        </Text>
        <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
          {error}
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Text size="lg" fw={600}>
        Option Positions
      </Text>

      <Paper withBorder p="md">
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Symbol</Table.Th>
              <Table.Th>Type</Table.Th>
              <Table.Th>Strike</Table.Th>
              <Table.Th>Qty</Table.Th>
              <Table.Th>Avg Price</Table.Th>
              <Table.Th>LTP</Table.Th>
              <Table.Th>P&L</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {positions.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={7} align="center">
                  <Text c="dimmed" py="md">
                    No open positions
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              positions.map((pos) => (
                <Table.Tr key={pos.instrument_key}>
                  <Table.Td fw={500}>{pos.trading_symbol}</Table.Td>
                  <Table.Td>
                    <Badge
                      size="sm"
                      color={pos.option_type === "CE" ? "green" : "red"}
                      variant="light"
                    >
                      {pos.option_type}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{pos.strike_price}</Table.Td>
                  <Table.Td>{pos.quantity}</Table.Td>
                  <Table.Td>₹{pos.average_price.toFixed(2)}</Table.Td>
                  <Table.Td>₹{pos.current_price?.toFixed(2) ?? "-"}</Table.Td>
                  <Table.Td>
                    {pos.pnl !== undefined ? (
                      <Text fw={600} c={pos.pnl >= 0 ? "green" : "red"}>
                        {pos.pnl >= 0 ? "+" : ""}₹{pos.pnl.toFixed(2)}
                      </Text>
                    ) : (
                      "-"
                    )}
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  );
}

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
      <Stack
        id="positions-panel"
        className="positions-panel"
        gap="md"
        data-testid="options-positions-panel"
      >
        <Text size="lg" fw={600} className="positions-title">
          Positions
        </Text>
        <Text c="dimmed" className="positions-loading" data-testid="options-positions-loading">
          Loading positions...
        </Text>
      </Stack>
    );
  }

  if (error) {
    return (
      <Stack
        id="positions-panel"
        className="positions-panel"
        gap="md"
        data-testid="options-positions-panel"
      >
        <Text size="lg" fw={600} className="positions-title">
          Positions
        </Text>
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          variant="light"
          className="positions-error"
          data-testid="options-positions-error"
        >
          {error}
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack
      id="positions-panel"
      className="positions-panel"
      gap="md"
      data-testid="options-positions-panel"
    >
      <Text size="lg" fw={600} className="positions-title">
        Option Positions
      </Text>

      <Paper
        withBorder
        p="md"
        className="positions-table-container"
        data-testid="options-positions-table-container"
      >
        <Table highlightOnHover className="positions-table" data-testid="options-positions-table">
          <Table.Thead className="positions-table-head">
            <Table.Tr className="positions-header-row">
              <Table.Th className="positions-header-cell">Symbol</Table.Th>
              <Table.Th className="positions-header-cell">Type</Table.Th>
              <Table.Th className="positions-header-cell">Strike</Table.Th>
              <Table.Th className="positions-header-cell">Qty</Table.Th>
              <Table.Th className="positions-header-cell">Avg Price</Table.Th>
              <Table.Th className="positions-header-cell">LTP</Table.Th>
              <Table.Th className="positions-header-cell">P&L</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody className="positions-table-body">
            {positions.length === 0 ? (
              <Table.Tr className="positions-empty-row" data-testid="options-positions-empty">
                <Table.Td colSpan={7} align="center">
                  <Text c="dimmed" py="md">
                    No open positions
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              positions.map((pos, index) => (
                <Table.Tr
                  key={pos.instrument_key}
                  className="position-row"
                  data-testid={`options-position-row-${index}`}
                >
                  <Table.Td
                    fw={500}
                    className="position-symbol"
                    data-testid={`options-position-symbol-${index}`}
                  >
                    {pos.trading_symbol}
                  </Table.Td>
                  <Table.Td className="position-type">
                    <Badge
                      size="sm"
                      color={pos.option_type === "CE" ? "green" : "red"}
                      variant="light"
                      data-testid={`options-position-type-${index}`}
                    >
                      {pos.option_type}
                    </Badge>
                  </Table.Td>
                  <Table.Td
                    className="position-strike"
                    data-testid={`options-position-strike-${index}`}
                  >
                    {pos.strike_price}
                  </Table.Td>
                  <Table.Td className="position-qty" data-testid={`options-position-qty-${index}`}>
                    {pos.quantity}
                  </Table.Td>
                  <Table.Td
                    className="position-avg-price"
                    data-testid={`options-position-avg-price-${index}`}
                  >
                    ₹{pos.average_price.toFixed(2)}
                  </Table.Td>
                  <Table.Td className="position-ltp" data-testid={`options-position-ltp-${index}`}>
                    ₹{pos.current_price?.toFixed(2) ?? "-"}
                  </Table.Td>
                  <Table.Td className="position-pnl" data-testid={`options-position-pnl-${index}`}>
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

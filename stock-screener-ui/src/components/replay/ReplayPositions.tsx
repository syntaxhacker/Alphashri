import { Table, Text, Badge, Group, Box } from "@/ui";
import { SideBadge } from "../common/BadgeComponents";
import { COMMON_TABLE_STYLES as TABLE_STYLES } from "../common/tableStyles";
import { formatTimeOnly } from "../../utils/ui-helpers";
import type { ReplayOpenPosition } from "../../types/replay";

interface ReplayPositionsProps {
  positions: ReplayOpenPosition[];
}

export function ReplayPositions({ positions }: ReplayPositionsProps) {
  if (positions.length === 0) return null;

  return (
    <Box data-testid="replay-positions">
      <Group gap="sm" mb={2}>
        <Text size="xs" fw={500}>
          Open Positions
        </Text>
        <Badge variant="light" color="blue" size="xs">
          {positions.length}
        </Badge>
      </Group>
      <Table striped highlightOnHover size="xs" styles={TABLE_STYLES}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Symbol</Table.Th>
            <Table.Th>Side</Table.Th>
            <Table.Th ta="center">Qty</Table.Th>
            <Table.Th ta="right">Entry Price</Table.Th>
            <Table.Th ta="right">SL</Table.Th>
            <Table.Th ta="right">TP</Table.Th>
            <Table.Th>Strategy</Table.Th>
            <Table.Th>Entry Time</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {positions.map((pos) => (
            <Table.Tr key={`${pos.symbol}-${pos.strategy}-${pos.id}`}>
              <Table.Td>
                <Text size="xs" fw={500}>
                  {pos.symbol}
                </Text>
              </Table.Td>
              <Table.Td>
                <SideBadge side={pos.side} size="xs" />
              </Table.Td>
              <Table.Td ta="center">
                <Text size="xs">{pos.quantity}</Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="xs">{pos.entry_price.toFixed(2)}</Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="xs" c="red">
                  {pos.sl.toFixed(2)}
                </Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="xs" c="green">
                  {pos.tp.toFixed(2)}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="xs">{pos.strategy}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="xs">{formatTimeOnly(pos.entry_time)}</Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Box>
  );
}

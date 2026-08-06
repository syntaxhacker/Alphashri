import { Table, Text } from "@/ui";
import type { InternalStockMover } from "./sectorUtils";
import { getPnLTextColor } from "../../utils/ui-helpers";

export function IntervalMoversTable({ movers }: { movers: InternalStockMover[] }) {
  if (movers.length === 0) {
    return (
      <Text size="sm" c="dimmed" ta="center" py="xl">
        Collecting baseline for interval moves...
      </Text>
    );
  }

  return (
    <Table striped highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Stock</Table.Th>
          <Table.Th align="right">Prev</Table.Th>
          <Table.Th align="right">Now</Table.Th>
          <Table.Th align="right">&Delta;</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {movers.map((mover) => (
          <Table.Tr key={mover.symbol}>
            <Table.Td fw={600}>{mover.symbol}</Table.Td>
            <Table.Td align="right">{mover.prev_change.toFixed(2)}%</Table.Td>
            <Table.Td align="right">{mover.change.toFixed(2)}%</Table.Td>
            <Table.Td align="right">
              <Text c={getPnLTextColor(mover.delta)} fw={700}>
                {mover.delta > 0 ? "+" : ""}
                {mover.delta.toFixed(2)}%
              </Text>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

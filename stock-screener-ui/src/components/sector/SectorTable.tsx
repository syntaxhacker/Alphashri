import { Table, Text, Badge, Group, ScrollArea, Progress, Box } from "@mantine/core";
import type { SectorItem } from "../../types/sector";
import { DataTable } from "../common/DataTable";
import { getPnLTextColor } from "../../utils/ui-helpers";
import { TableEmptyState } from "../common/TableEmptyState";

interface SectorTableProps {
  sectors: SectorItem[];
}

export function getMovementBarValue(pctChange: number): { capped: number; color: string } {
  const normalized = (pctChange + 3) / 6;
  const capped = Math.max(0, Math.min(1, normalized)) * 100;
  const color = getPnLTextColor(pctChange);
  return { capped, color };
}

export function getStrengthInfo(avgAdx: number): { label: string; color: string } {
  if (avgAdx > 25) return { label: "Strong", color: "green" };
  if (avgAdx < 15) return { label: "Weak", color: "red" };
  return { label: "Neutral", color: "gray" };
}

function getMovementBar(pctChange: number) {
  const { capped, color } = getMovementBarValue(pctChange);

  return (
    <Box w={100}>
      <Progress value={capped} color={color} size="sm" radius="xl" />
    </Box>
  );
}
export function SectorTable({ sectors }: SectorTableProps) {
  const rows = sectors.map((row) => {
    const pnlColor = getPnLTextColor(row.avg_change);
    const adColor = row.advances > row.declines ? "green" : "red";

    const { label: strength, color: strColor } = getStrengthInfo(row.avg_adx);

    return (
      <Table.Tr
        key={row.sector}
        data-testid={`sector-row-${row.sector.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <Table.Td fw={700}>{row.sector}</Table.Td>
        <Table.Td align="right">
          <Text c={pnlColor} fw={700}>
            {row.avg_change >= 0 ? "+" : ""}
            {row.avg_change.toFixed(2)}%
          </Text>
        </Table.Td>
        <Table.Td>
          <Group justify="center">{getMovementBar(row.avg_change)}</Group>
        </Table.Td>
        <Table.Td align="center">
          <Text c={adColor} size="sm" fw={600}>
            {row.advances} : {row.declines}
          </Text>
        </Table.Td>
        <Table.Td align="center">
          <Badge color={strColor} variant="light" size="sm">
            {strength}
          </Badge>
        </Table.Td>
        <Table.Td>
          <Text size="sm" c="dimmed" lineClamp={1}>
            {row.top_movers}
          </Text>
        </Table.Td>
      </Table.Tr>
    );
  });

  return (
    <ScrollArea h="100%" offsetScrollbars>
      <DataTable withTableBorder stickyHeader id="sector-table" dataTestId="sector-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Sector</Table.Th>
            <Table.Th align="right">Change</Table.Th>
            <Table.Th align="center">Movement</Table.Th>
            <Table.Th align="center">A/D Ratio</Table.Th>
            <Table.Th align="center">Strength</Table.Th>
            <Table.Th>Top Movers</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sectors.length === 0 ? (
            <Table.Tr>
              <Table.Td colSpan={6}>
                <TableEmptyState message="No sector data available" />
              </Table.Td>
            </Table.Tr>
          ) : (
            rows
          )}
        </Table.Tbody>
      </DataTable>
    </ScrollArea>
  );
}

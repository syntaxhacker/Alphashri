import { Flex, Table, Text, Group, Badge } from "@/ui";

interface TopBottomViewProps {
  stocks: any[];
  metric: string;
  getMetricValue: (stock: any, metric: string) => number;
  getMetricColor: (value: number, min: number, max: number) => string;
  getMetricTextColor: (value: number, min: number, max: number) => string;
  METRICS: { value: string; label: string; fmt: (v: number) => string }[];
}

export function TopBottomView({ stocks, metric, getMetricValue, getMetricColor, getMetricTextColor, METRICS }: TopBottomViewProps) {
  const metricConfig = METRICS.find((m) => m.value === metric) || METRICS[0];
  const fmt = metricConfig?.fmt ?? ((v: number) => v.toFixed(2));

  const metricValues = stocks.map((s) => getMetricValue(s, metric));
  const minAll = metricValues.length ? Math.min(...metricValues) : 0;
  const maxAll = metricValues.length ? Math.max(...metricValues) : 1;

  const top10 = stocks.slice(0, 10);
  const bottom10 = [...stocks].slice(-10).reverse();

  function formatPe(pe: number | null | undefined): string {
    if (pe == null || pe === 0) return "-";
    return pe.toFixed(1);
  }

  function renderTable(title: string, badgeColor: string, data: any[], startRank: number) {
    return (
      <Flex direction="column" style={{ flex: 1 }}>
        <Group gap="xs" mb="xs">
          <Text size="sm" fw={600}>{title}</Text>
          <Badge color={badgeColor} size="sm" variant="light">{data.length}</Badge>
        </Group>
        <Table striped highlightOnHover size="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>#</Table.Th>
              <Table.Th>Symbol</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th ta="right">{metricConfig?.label ?? metric}</Table.Th>
              <Table.Th ta="right">P/E</Table.Th>
              <Table.Th>Sector</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.map((stock: any, i: number) => {
              const mv = getMetricValue(stock, metric);
              const bg = getMetricColor(mv, minAll, maxAll);
              const tc = getMetricTextColor(mv, minAll, maxAll);
              return (
                <Table.Tr key={stock.symbol}>
                  <Table.Td>
                    <Text size="xs" c="dimmed">{startRank + i}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" fw={500}>{stock.symbol}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" truncate maw={160}>{stock.name}</Text>
                  </Table.Td>
                  <Table.Td ta="right" style={{ backgroundColor: bg, color: tc, fontWeight: "bold" }}>
                    {fmt(mv)}
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="xs">{formatPe(stock.pe_ratio)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" truncate maw={120}>{stock.sector}</Text>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Flex>
    );
  }

  return (
    <Flex gap="md" p="sm" style={{ flex: 1 }}>
      {renderTable("Top 10", "green", top10, 1)}
      {renderTable("Bottom 10", "red", bottom10, stocks.length - bottom10.length + 1)}
    </Flex>
  );
}

import { Paper, SimpleGrid, Text } from "@mantine/core";

interface ScreenerSummaryProps {
  summary: Array<{
    label: string;
    value: string | number;
    color?: string;
  }>;
}

export function ScreenerSummary({ summary }: ScreenerSummaryProps) {
  return (
    <SimpleGrid cols={{ base: 2, sm: 2, md: 4, lg: 4 }} id="screener-summary" className="screener-summary" data-testid="screener-summary">
      {summary.map((item, index) => (
        <Paper key={index} p="md" withBorder className="summary-card" data-testid={`summary-card-${index}`}>
          <Text size="sm" c="dimmed" tt="uppercase" fw={500} className="summary-label" data-testid={`summary-label-${index}`}>
            {item.label}
          </Text>
          <Text size="xl" fw={700} c={item.color} className="summary-value" data-testid={`summary-value-${index}`}>
            {item.value}
          </Text>
        </Paper>
      ))}
    </SimpleGrid>
  );
}

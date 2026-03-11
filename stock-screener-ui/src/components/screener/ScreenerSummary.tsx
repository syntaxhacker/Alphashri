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
    <SimpleGrid cols={{ base: 2, sm: 2, md: 4, lg: 4 }}>
      {summary.map((item, index) => (
        <Paper key={index} p="md" withBorder>
          <Text size="xs" c="dimmed" tt="uppercase" fw={500}>
            {item.label}
          </Text>
          <Text size="xl" fw={700} c={item.color}>
            {item.value}
          </Text>
        </Paper>
      ))}
    </SimpleGrid>
  );
}

import { Badge, Paper, Progress, Stack, Group, Text, Tooltip } from "@/ui";

interface ImpactScoreProps {
  score?: number;
}

export function ImpactScore({ score }: ImpactScoreProps) {
  if (score === undefined || score === null) return null;
  const color = score >= 7 ? "red" : score >= 4 ? "orange" : "gray";
  const label = score >= 7 ? "High impact" : score >= 4 ? "Moderate impact" : "Low impact";

  return (
    <Tooltip label={`Impact Score: ${score}/10`}>
      <Paper withBorder p="xs" radius="md" maw={220} miw={180} data-testid="impact-score">
        <Stack gap={6}>
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Text size="xs" fw={700} tt="uppercase" c="dimmed">
              Impact
            </Text>
            <Badge size="sm" color={color} variant="light">
              {score}/10
            </Badge>
          </Group>
          <Progress value={score * 10} color={color} radius="xl" size="lg" />
          <Text size="xs" c={color} fw={600}>
            {label}
          </Text>
        </Stack>
      </Paper>
    </Tooltip>
  );
}

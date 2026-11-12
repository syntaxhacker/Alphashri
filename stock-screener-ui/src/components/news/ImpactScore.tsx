import { Show } from "solid-js";
import { Badge, Paper, Progress, Stack, Group, Text, Tooltip } from "@/ui";

interface ImpactScoreProps {
  score?: number;
  compact?: boolean;
}

export function ImpactScore(props: ImpactScoreProps) {
  const score = () => props.score;
  const compact = () => props.compact ?? false;
  const color = () => {
    const s = score()!;
    return s >= 7 ? "error" : s >= 4 ? "warning" : "secondary";
  };
  const label = () => {
    const s = score()!;
    return s >= 7 ? "High impact" : s >= 4 ? "Moderate impact" : "Low impact";
  };

  return (
    <Show when={score() != null}>
      <Show
        when={compact()}
        fallback={
          <Tooltip label={`Impact Score: ${score()}/10`}>
            <Paper p="xs" radius="md" maw={220} miw={180} data-testid="impact-score">
              <Stack gap={6}>
                <Group justify="space-between" gap="xs" wrap="nowrap" align="center">
                  <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                    Impact
                  </Text>
                  <Badge size="sm" color={color()} variant="light">
                    {score()}/10
                  </Badge>
                </Group>
                <Progress value={score()! * 10} color={color()} radius="xl" size="lg" />
                <Text size="xs" c={color()} fw={600}>
                  {label()}
                </Text>
              </Stack>
            </Paper>
          </Tooltip>
        }
      >
        <Tooltip label={`${label()}: ${score()}/10`}>
          <Badge
            size="xs"
            color={color()}
            variant="light"
            data-testid="impact-score"
            className="flex-[0_0_auto] tabular-nums"
          >
            {score()}/10
          </Badge>
        </Tooltip>
      </Show>
    </Show>
  );
}

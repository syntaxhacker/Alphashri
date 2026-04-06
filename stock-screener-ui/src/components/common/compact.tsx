import type { ReactNode } from "react";
import {
  Group,
  Box,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
  type PaperProps,
  type StackProps,
} from "@mantine/core";

export const COMPACT_STAT_BG = "light-dark(rgba(248, 250, 252, 0.85), rgba(15, 23, 42, 0.55))";

interface CompactPageProps extends StackProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function CompactPage({
  title,
  description,
  actions,
  children,
  ...stackProps
}: CompactPageProps) {
  return (
    <Stack
      gap="sm"
      style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}
      {...stackProps}
    >
      {(title || description || actions) && (
        <Group justify="space-between" align="flex-start" gap="sm">
          <Stack gap={2}>
            {title ? (
              typeof title === "string" ? (
                <Title order={2} size="h4">
                  {title}
                </Title>
              ) : (
                title
              )
            ) : null}
            {description ? (
              <Text size="sm" c="dimmed">
                {description}
              </Text>
            ) : null}
          </Stack>
          {actions}
        </Group>
      )}
      <Box flex={1} style={{ minHeight: 0 }}>
        {children}
      </Box>
    </Stack>
  );
}

interface CompactPanelProps extends PaperProps {
  children: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  padded?: boolean;
  testId?: string;
  id?: string;
}

export function CompactPanel({
  children,
  title,
  description,
  action,
  padded = true,
  testId,
  style,
  ...paperProps
}: CompactPanelProps) {
  return (
    <Paper
      radius="xs"
      p={padded ? "sm" : 0}
      shadow="none"
      bg="light-dark(var(--mantine-color-white), var(--mantine-color-dark-7))"
      style={{
        overflow: "hidden",
        ...style,
      }}
      data-testid={testId}
      {...paperProps}
    >
      {(title || description || action) && (
        <Group justify="space-between" align="flex-start" gap="sm" mb="sm">
          <Stack gap={2}>
            {title ? (
              typeof title === "string" ? (
                <Title order={4} size="h5">
                  {title}
                </Title>
              ) : (
                title
              )
            ) : null}
            {description ? (
              <Text size="sm" c="dimmed" data-testid="status">
                {description}
              </Text>
            ) : null}
          </Stack>
          {action}
        </Group>
      )}
      {children}
    </Paper>
  );
}

interface CompactStatProps extends PaperProps {
  label: ReactNode;
  value: ReactNode;
  tone?: string;
  hint?: ReactNode;
}

export function CompactStat({
  label,
  value,
  tone = "var(--mantine-color-text)",
  hint,
  ...paperProps
}: CompactStatProps) {
  return (
    <Paper
      radius="xs"
      p="sm"
      bg={COMPACT_STAT_BG}
      {...paperProps}
    >
      <Text size="xs" tt="uppercase" fw={700} c="dimmed" lh={1.1}>
        {label}
      </Text>
      <Text size="lg" fw={700} c={tone} lh={1.1}>
        {value}
      </Text>
      {hint ? (
        typeof hint === "string" || typeof hint === "number" ? (
          <Text size="xs" c="dimmed" mt={4}>
            {hint}
          </Text>
        ) : (
          <div style={{ marginTop: 4 }}>{hint}</div>
        )
      ) : null}
    </Paper>
  );
}

export function CompactStatGrid({
  children,
  ...props
}: {
  children: ReactNode;
  [key: string]: any;
}) {
  return (
    <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm" {...props}>
      {children}
    </SimpleGrid>
  );
}

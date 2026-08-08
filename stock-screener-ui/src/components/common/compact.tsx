import type { ReactNode, CSSProperties } from "react";
import { Card, Group, Box, Paper, SimpleGrid, Stack, Text, Title } from "@/ui";
import type { UIStackProps, UIPaperProps } from "@/ui";

const SCROLLABLE_PANEL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};

const SCROLL_CONTAINER_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "auto",
};

interface CompactPageProps extends UIStackProps {
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
      <Box flex={1} style={{ minHeight: 0, overflow: "auto" }}>
        {children}
      </Box>
    </Stack>
  );
}

interface CompactPanelProps extends UIPaperProps {
  children: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  padded?: boolean;
  testId?: string;
  id?: string;
  scrollable?: boolean;
}

export function CompactPanel({
  children,
  title,
  description,
  action,
  padded = true,
  testId,
  style,
  scrollable = false,
  ...paperProps
}: CompactPanelProps) {
  const panelStyle: CSSProperties = scrollable ? { ...SCROLLABLE_PANEL_STYLE, ...style } : style;

  return (
    <Paper
      radius="xs"
      p={padded ? "xs" : 0}
      shadow="none"
      bg="light-dark(var(--mantine-color-white), var(--mantine-color-dark-7))"
      style={panelStyle}
      data-testid={testId}
      {...paperProps}
    >
      {(title || description || action) && (
        <Group justify="space-between" align="flex-start" gap="xs" mb="xs">
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
      {scrollable ? <Box style={SCROLL_CONTAINER_STYLE}>{children}</Box> : children}
    </Paper>
  );
}

interface CompactStatProps extends UIPaperProps {
  label: ReactNode;
  value: ReactNode;
  tone?: string;
  hint?: ReactNode;
  labelSize?: "xs" | "sm" | "md" | "lg" | "xl";
  valueSize?: "xs" | "sm" | "md" | "lg" | "xl";
}

export function CompactStat({
  label,
  value,
  tone = "var(--mantine-color-text)",
  hint,
  labelSize = "xs",
  valueSize = "lg",
  ...paperProps
}: CompactStatProps) {
  return (
    <Card
      radius="xs"
      p="xs"
      withBorder
      shadow="none"
      bg="light-dark(rgba(248, 250, 252, 0.85), rgba(15, 23, 42, 0.55))"
      {...paperProps}
    >
      <Text size={labelSize} tt="uppercase" fw={700} c="dimmed" lh={1.1}>
        {label}
      </Text>
      <Text size={valueSize} fw={700} c={tone} lh={1.1}>
        {value}
      </Text>
      {hint ? (
        typeof hint === "string" || typeof hint === "number" ? (
          <Text size="xs" c="dimmed" mt={2}>
            {hint}
          </Text>
        ) : (
          <Box mt={4}>{hint}</Box>
        )
      ) : null}
    </Card>
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
    <SimpleGrid cols={{ base: 2, md: 4 }} spacing="xs" {...props}>
      {children}
    </SimpleGrid>
  );
}

import { Badge, Box, Group, Text } from "@/ui";

interface SectionHeaderProps {
  title: string;
  badge?: string | number;
  color?: string;
  "data-testid"?: string;
}

export function SectionHeader({ title, badge, color = "blue", "data-testid": testId }: SectionHeaderProps) {
  return (
    <Group gap="xs" data-testid={testId}>
      <Box w={4} h={18} style={{ borderRadius: 2, backgroundColor: `var(--mantine-color-${color}-6)` }} />
      <Text fw={600} size="sm">
        {title}
      </Text>
      {badge != null && (
        <Badge size="sm" variant="light" color={color}>
          {badge}
        </Badge>
      )}
    </Group>
  );
}

import { Badge, Box, Group, Text } from "@/ui";

interface SectionHeaderProps {
  title: string;
  badge?: string | number;
  color?: string;
  "data-testid"?: string;
}

const ACCENT_CLASS: Record<string, string> = {
  blue: "bg-fin-primary",
  green: "bg-fin-positive",
  red: "bg-fin-negative",
  orange: "bg-fin-warning",
  teal: "bg-fin-info",
  cyan: "bg-fin-info",
  violet: "bg-fin-text-muted",
  grape: "bg-fin-text-muted",
};

export function SectionHeader({ title, badge, color = "primary", "data-testid": testId }: SectionHeaderProps) {
  return (
    <Group gap="xs" data-testid={testId}>
      <Box w={4} h={18} className={`rounded-fin ${ACCENT_CLASS[color] ?? "bg-fin-primary"}`} />
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

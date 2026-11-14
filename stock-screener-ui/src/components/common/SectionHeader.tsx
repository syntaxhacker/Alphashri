import { Show } from "solid-js";
import { Badge, Box, Group, Text } from "@/ui";

interface SectionHeaderProps {
  title: string;
  badge?: string | number;
  color?: string;
  "data-testid"?: string;
  // Historical spelling used by some callers — kept as an alias.
  dataTestid?: string;
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

export function SectionHeader(props: SectionHeaderProps) {
  const color = () => props.color ?? "primary";
  const testId = () => props["data-testid"] ?? props.dataTestid;

  return (
    <Group gap="xs" data-testid={testId()}>
      <Box w={4} h={18} className={`rounded-fin ${ACCENT_CLASS[color()] ?? "bg-fin-primary"}`} />
      <Text fw={600} size="sm">
        {props.title}
      </Text>
      <Show when={props.badge != null}>
        <Badge size="sm" variant="light" color={color()}>
          {props.badge}
        </Badge>
      </Show>
    </Group>
  );
}

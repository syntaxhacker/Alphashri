import type { ReactNode } from "react";
import { Text, Badge } from "@mantine/core";
import { getPnLTextColor } from "../../utils/ui-helpers";

interface PnlTextProps {
  value: number;
  children?: ReactNode;
  size?: string;
  fw?: number | string;
  span?: boolean;
  ml?: number | string;
  fs?: string;
  "data-testid"?: string;
}

export function PnlText({
  value,
  children,
  size,
  fw,
  span,
  ml,
  fs,
  "data-testid": testId,
}: PnlTextProps) {
  const color = getPnLTextColor(value);
  const displayText = children ?? (value >= 0 ? `+${value}` : `${value}`);

  return (
    <Text
      c={color}
      fw={fw ?? 600}
      size={size}
      component={span ? "span" : undefined}
      ml={ml}
      fs={fs}
      data-testid={testId}
    >
      {displayText}
    </Text>
  );
}

interface PnlBadgeProps {
  value: number;
  children?: string;
  size?: string;
  "data-testid"?: string;
}

export function PnlBadge({ value, children, size, "data-testid": testId }: PnlBadgeProps) {
  const color = getPnLTextColor(value);
  const displayText = children ?? (value >= 0 ? `+${value}` : `${value}`);

  return (
    <Badge color={color} variant="light" size={size} data-testid={testId}>
      {displayText}
    </Badge>
  );
}

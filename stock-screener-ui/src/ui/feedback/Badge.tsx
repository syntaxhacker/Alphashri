import { Badge as MantineBadge } from "@mantine/core";
import type { UIBadgeProps } from "../types";

export function Badge({ children, leftSection, rightSection, className, style, "data-testid": testId, ...rest }: UIBadgeProps) {
  return <MantineBadge leftSection={leftSection} rightSection={rightSection} className={className} style={style} data-testid={testId} {...rest}>{children}</MantineBadge>;
}

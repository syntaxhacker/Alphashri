import { ThemeIcon as MantineThemeIcon } from "@mantine/core";
import type { UIThemeIconProps } from "../types";

export function ThemeIcon({ variant, color, size, radius, children, className, style, "data-testid": testId, ...rest }: UIThemeIconProps) {
  return <MantineThemeIcon variant={variant} color={color} size={size} radius={radius} className={className} style={style} data-testid={testId} {...rest}>{children}</MantineThemeIcon>;
}

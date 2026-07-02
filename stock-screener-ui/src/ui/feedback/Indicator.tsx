import { Indicator as MantineIndicator } from "@mantine/core";
import type { UIIndicatorProps } from "../types";

export function Indicator({ label, color, size, offset, disabled, processing, withBorder, position, children, className, style, "data-testid": testId, ...rest }: UIIndicatorProps) {
  return <MantineIndicator label={label} color={color} size={size} offset={offset} disabled={disabled} processing={processing} withBorder={withBorder} position={position} className={className} style={style} data-testid={testId} {...rest}>{children}</MantineIndicator>;
}

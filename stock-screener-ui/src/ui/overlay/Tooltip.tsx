import { Tooltip as MantineTooltip } from "@mantine/core";
import type { UITooltipProps } from "../types";

export function Tooltip({ label, withArrow, position, openDelay, closeDelay, disabled, multiline, color, children, className, style, "data-testid": testId, ...rest }: UITooltipProps) {
  return <MantineTooltip label={label} withArrow={withArrow} position={position} openDelay={openDelay} closeDelay={closeDelay} disabled={disabled} multiline={multiline} color={color} className={className} style={style} data-testid={testId} {...rest}>{children}</MantineTooltip>;
}
Tooltip.Group = MantineTooltip.Group;
Tooltip.Floating = MantineTooltip.Floating;

import { Popover as MantinePopover } from "@mantine/core";
import type { UIPopoverProps, UIPopoverTargetProps, UIPopoverDropdownProps } from "../types";

export function Popover({ children, opened, onClose, className, style, "data-testid": testId, ...rest }: UIPopoverProps) {
  return <MantinePopover opened={opened} onClose={onClose} className={className} style={style} data-testid={testId} {...rest}>{children}</MantinePopover>;
}

export function PopoverTarget({ children, className, style }: UIPopoverTargetProps) {
  return <MantinePopover.Target className={className} style={style}>{children}</MantinePopover.Target>;
}

export function PopoverDropdown({ children, className, style }: UIPopoverDropdownProps) {
  return <MantinePopover.Dropdown className={className} style={style}>{children}</MantinePopover.Dropdown>;
}
Popover.Target = PopoverTarget;
Popover.Dropdown = PopoverDropdown;

import { Popover as MantinePopover } from "@mantine/core";
import type { UIPopoverProps, UIPopoverTargetProps, UIPopoverDropdownProps } from "../types";

export function Popover({ children, opened, onClose, className, style, "data-testid": testId, ...rest }: UIPopoverProps) {
  return <MantinePopover opened={opened} onClose={onClose} {...({ className, style, "data-testid": testId, children: children as any, ...rest } as any)}>{children}</MantinePopover>;
}

export function PopoverTarget({ children, className, style }: UIPopoverTargetProps) {
  return <MantinePopover.Target {...({ className, style } as any)}>{children}</MantinePopover.Target>;
}

export function PopoverDropdown({ children, className, style }: UIPopoverDropdownProps) {
  return <MantinePopover.Dropdown {...({ className, style } as any)}>{children}</MantinePopover.Dropdown>;
}
Popover.Target = PopoverTarget;
Popover.Dropdown = PopoverDropdown;

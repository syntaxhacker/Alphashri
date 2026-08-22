import { Menu as MantineMenu } from "@mantine/core";
import type { UIMenuProps, UIMenuTargetProps, UIMenuDropdownProps, UIMenuItemProps } from "../types";

export function Menu({ trigger, opened, onChange, position, offset, withArrow, shadow, closeOnItemClick, closeOnClickOutside, loop, children, renderTarget, className, style, "data-testid": testId, ...rest }: UIMenuProps) {
  return <MantineMenu trigger={trigger} opened={opened} onChange={onChange as any} position={position} offset={offset} withArrow={withArrow} shadow={shadow} closeOnItemClick={closeOnItemClick} closeOnClickOutside={closeOnClickOutside} loop={loop} {...({ className, style, "data-testid": testId, ...rest } as any)}>{children}</MantineMenu>;
}

export function MenuTarget({ children, className, style, "data-testid": testId, ...rest }: UIMenuTargetProps) {
  return <MantineMenu.Target {...({ className, style, "data-testid": testId, ...rest } as any)}>{children}</MantineMenu.Target>;
}

export function MenuDropdown({ children, className, style, "data-testid": testId, ...rest }: UIMenuDropdownProps) {
  return <MantineMenu.Dropdown className={className} style={style} data-testid={testId} {...rest}>{children}</MantineMenu.Dropdown>;
}

export function MenuItem({ leftSection, rightSection, color, disabled, onClick, children, className, style, "data-testid": testId, ...rest }: UIMenuItemProps) {
  return <MantineMenu.Item leftSection={leftSection} rightSection={rightSection} color={color} disabled={disabled} onClick={onClick} className={className} style={style} data-testid={testId} {...rest}>{children}</MantineMenu.Item>;
}
Menu.Target = MenuTarget;
Menu.Dropdown = MenuDropdown;
Menu.Item = MenuItem;
Menu.Divider = MantineMenu.Divider;
Menu.Label = MantineMenu.Label;

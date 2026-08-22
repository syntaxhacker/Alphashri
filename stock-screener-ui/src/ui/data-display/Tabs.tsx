import { Tabs as MantineTabs } from "@mantine/core";
import type { UITabsProps, UITabProps, UITabsPanelProps } from "../types";

export function Tabs({ value, defaultValue, onChange, variant, color, orientation, activateOnFocus, loop, children, className, style, "data-testid": testId, ...rest }: UITabsProps) {
  return <MantineTabs value={value} defaultValue={defaultValue} onChange={onChange} variant={variant} color={color} orientation={orientation} activateOnFocus={activateOnFocus} loop={loop} className={className} style={style} data-testid={testId} {...(rest as any)}>{children}</MantineTabs>;
}

export function TabsList({ children, className, style, "data-testid": testId, ...rest }: UITabsProps) {
  return <MantineTabs.List {...({ className, style, "data-testid": testId, ...rest } as any)}>{children}</MantineTabs.List>;
}

export function Tab({ value, icon, rightSection, disabled, children, className, style, "data-testid": testId, ...rest }: UITabProps) {
  return <MantineTabs.Tab value={value} icon={icon} rightSection={rightSection} disabled={disabled} {...({ className, style, "data-testid": testId, ...rest } as any)}>{children}</MantineTabs.Tab>;
}

export function TabsPanel({ value, keepMounted, children, className, style, "data-testid": testId, ...rest }: UITabsPanelProps) {
  return <MantineTabs.Panel value={value} keepMounted={keepMounted} className={className} style={style} data-testid={testId} {...rest}>{children}</MantineTabs.Panel>;
}
Tabs.List = TabsList;
Tabs.Tab = Tab;
Tabs.Panel = TabsPanel;

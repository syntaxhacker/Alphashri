import { AppShell as MantineAppShell } from "@mantine/core";
import type { UIAppShellProps, UIAppShellHeaderProps, UIAppShellNavbarProps, UIAppShellMainProps, UIAppShellSectionProps } from "../types";

export function AppShell({ header, navbar, padding, layout, children, className, style, "data-testid": testId, ...rest }: UIAppShellProps) {
  return <MantineAppShell header={header} navbar={navbar} padding={padding} layout={layout} className={className} style={style} data-testid={testId} {...rest}>{children}</MantineAppShell>;
}

export function AppShellHeader({ children, className, style, "data-testid": testId, ...rest }: UIAppShellHeaderProps) {
  return <MantineAppShell.Header className={className} style={style} data-testid={testId} {...rest}>{children}</MantineAppShell.Header>;
}

export function AppShellNavbar({ p, children, className, style, "data-testid": testId, ...rest }: UIAppShellNavbarProps) {
  return <MantineAppShell.Navbar p={p} className={className} style={style} data-testid={testId} {...rest}>{children}</MantineAppShell.Navbar>;
}

export function AppShellMain({ children, className, style, "data-testid": testId, ...rest }: UIAppShellMainProps) {
  return <MantineAppShell.Main className={className} style={style} data-testid={testId} {...rest}>{children}</MantineAppShell.Main>;
}

export function AppShellSection({ children, className, style, "data-testid": testId, ...rest }: UIAppShellSectionProps) {
  return <MantineAppShell.Section className={className} style={style} data-testid={testId} {...rest}>{children}</MantineAppShell.Section>;
}
AppShell.Header = AppShellHeader;
AppShell.Navbar = AppShellNavbar;
AppShell.Main = AppShellMain;
AppShell.Section = AppShellSection;

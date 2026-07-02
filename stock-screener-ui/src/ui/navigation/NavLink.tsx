import { NavLink as MantineNavLink } from "@mantine/core";
import type { UINavLinkProps } from "../types";

export function NavLink({ label, description, icon, rightSection, href, active, disabled, variant, defaultOpened, opened, onClick, children, autoContrast, className, style, "data-testid": testId, ...rest }: UINavLinkProps) {
  return <MantineNavLink label={label} description={description} icon={icon} rightSection={rightSection} href={href} active={active} disabled={disabled} variant={variant} defaultOpened={defaultOpened} opened={opened} onClick={onClick} autoContrast={autoContrast} className={className} style={style} data-testid={testId} {...rest}>{children}</MantineNavLink>;
}

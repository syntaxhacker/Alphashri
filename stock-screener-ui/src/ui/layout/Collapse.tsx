import { Collapse as MantineCollapse } from "@mantine/core";
import type { UICollapseProps } from "../types";

export function Collapse({ children, className, style, "data-testid": testId, ...rest }: UICollapseProps) {
  return <MantineCollapse className={className} style={style} data-testid={testId} {...rest}>{children}</MantineCollapse>;
}

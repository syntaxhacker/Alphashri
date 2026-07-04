import { Group as MantineGroup } from "@mantine/core";
import type { UIGroupProps } from "../types";

export function Group({ children, className, style, onClick, "data-testid": testId, ...rest }: UIGroupProps) {
  return <MantineGroup className={className} style={style} onClick={onClick} data-testid={testId} {...rest}>{children}</MantineGroup>;
}

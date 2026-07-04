import { ActionIcon as MantineActionIcon } from "@mantine/core";
import type { UIActionIconProps } from "../types";

export function ActionIcon({ children, className, style, onClick, "data-testid": testId, ...rest }: UIActionIconProps) {
  return <MantineActionIcon className={className} style={style} onClick={onClick} data-testid={testId} {...rest}>{children}</MantineActionIcon>;
}

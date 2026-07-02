import { Divider as MantineDivider } from "@mantine/core";
import type { UIDividerProps } from "../types";

export function Divider({ children, className, style, "data-testid": testId, ...rest }: UIDividerProps) {
  return <MantineDivider className={className} style={style} data-testid={testId} {...rest}>{children}</MantineDivider>;
}

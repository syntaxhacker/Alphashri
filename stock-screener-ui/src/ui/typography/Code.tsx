import { Code as MantineCode } from "@mantine/core";
import type { UICodeProps } from "../types";

export function Code({ children, block, color, className, style, "data-testid": testId }: UICodeProps) {
  return <MantineCode block={block} color={color} className={className} style={style} data-testid={testId}>{children}</MantineCode>;
}

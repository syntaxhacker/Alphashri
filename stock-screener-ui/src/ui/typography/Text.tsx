import { Text as MantineText } from "@mantine/core";
import type { UITextProps } from "../types";

export function Text({ children, className, style, onClick, "data-testid": testId, ...rest }: UITextProps) {
  return <MantineText className={className} style={style} onClick={onClick} data-testid={testId} {...rest}>{children}</MantineText>;
}

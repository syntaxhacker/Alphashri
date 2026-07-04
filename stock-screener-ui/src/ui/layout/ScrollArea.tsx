import { ScrollArea as MantineScrollArea } from "@mantine/core";
import type { UIScrollAreaProps } from "../types";

export function ScrollArea({ children, className, style, "data-testid": testId, ...rest }: UIScrollAreaProps) {
  return <MantineScrollArea className={className} style={style} data-testid={testId} {...rest}>{children}</MantineScrollArea>;
}

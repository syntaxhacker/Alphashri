import { ScrollArea as MantineScrollArea } from "@mantine/core";
import type { UIScrollAreaProps } from "../types";

export const ScrollArea = Object.assign(
  ({ children, className, style, "data-testid": testId, ...rest }: UIScrollAreaProps) => {
    return <MantineScrollArea className={className} style={style} data-testid={testId} {...rest}>{children}</MantineScrollArea>;
  },
  { Autosize: MantineScrollArea.Autosize },
);

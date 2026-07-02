import { Grid as MantineGrid } from "@mantine/core";
import type { UIGridProps, UIGridColProps } from "../types";

export function GridCol({ children, className, style, "data-testid": testId, ...rest }: UIGridColProps) {
  return <MantineGrid.Col className={className} style={style} data-testid={testId} {...rest}>{children}</MantineGrid.Col>;
}

export function Grid({ children, className, style, "data-testid": testId, ...rest }: UIGridProps) {
  return <MantineGrid className={className} style={style} data-testid={testId} {...rest}>{children}</MantineGrid>;
}
Grid.Col = GridCol;

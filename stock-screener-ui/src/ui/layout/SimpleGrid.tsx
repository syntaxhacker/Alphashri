import { SimpleGrid as MantineSimpleGrid } from "@mantine/core";
import type { UISimpleGridProps } from "../types";

export function SimpleGrid({ children, className, style, "data-testid": testId, ...rest }: UISimpleGridProps) {
  return <MantineSimpleGrid className={className} style={style} data-testid={testId} {...rest}>{children}</MantineSimpleGrid>;
}

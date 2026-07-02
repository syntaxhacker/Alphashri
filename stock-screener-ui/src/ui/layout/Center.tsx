import { Center as MantineCenter } from "@mantine/core";
import type { UICenterProps } from "../types";

export function Center({ children, className, style, "data-testid": testId, ...rest }: UICenterProps) {
  return <MantineCenter className={className} style={style} data-testid={testId} {...rest}>{children}</MantineCenter>;
}

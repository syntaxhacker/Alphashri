import { Stack as MantineStack } from "@mantine/core";
import type { UIStackProps } from "../types";

export function Stack({ children, className, style, onClick, "data-testid": testId, ...rest }: UIStackProps) {
  return <MantineStack className={className} style={style} onClick={onClick} data-testid={testId} {...rest}>{children}</MantineStack>;
}

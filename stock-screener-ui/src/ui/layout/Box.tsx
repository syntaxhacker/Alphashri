import { Box as MantineBox } from "@mantine/core";
import type { UIBoxProps } from "../types";

export function Box({ children, className, style, id, "data-testid": testId, onClick, ...rest }: UIBoxProps) {
  return <MantineBox className={className} style={style} id={id} data-testid={testId} onClick={onClick} {...rest}>{children}</MantineBox>;
}

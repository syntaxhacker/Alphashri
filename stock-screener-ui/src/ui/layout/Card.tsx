import { Card as MantineCard } from "@mantine/core";
import type { UICardProps } from "../types";

export function Card({ children, className, style, onClick, "data-testid": testId, ...rest }: UICardProps) {
  return <MantineCard className={className} style={style} onClick={onClick} data-testid={testId} {...rest}>{children}</MantineCard>;
}

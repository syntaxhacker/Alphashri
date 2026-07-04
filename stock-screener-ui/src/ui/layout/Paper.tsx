import { Paper as MantinePaper } from "@mantine/core";
import type { UIPaperProps } from "../types";

export function Paper({ children, className, style, onClick, "data-testid": testId, ...rest }: UIPaperProps) {
  return <MantinePaper className={className} style={style} onClick={onClick} data-testid={testId} {...rest}>{children}</MantinePaper>;
}

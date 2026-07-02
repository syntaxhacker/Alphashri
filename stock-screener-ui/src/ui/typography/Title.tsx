import { Title as MantineTitle } from "@mantine/core";
import type { UITitleProps } from "../types";

export function Title({ children, order, c, ta, fw, size, lh, className, style, "data-testid": testId }: UITitleProps) {
  return <MantineTitle order={order} c={c} ta={ta} fw={fw} size={size} lh={lh} className={className} style={style} data-testid={testId}>{children}</MantineTitle>;
}

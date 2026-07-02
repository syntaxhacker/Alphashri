import { Flex as MantineFlex } from "@mantine/core";
import type { UIFlexProps } from "../types";

export function Flex({ children, className, style, onClick, "data-testid": testId, ...rest }: UIFlexProps) {
  return <MantineFlex className={className} style={style} onClick={onClick} data-testid={testId} {...rest}>{children}</MantineFlex>;
}

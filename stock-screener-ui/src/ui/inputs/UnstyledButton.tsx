import { UnstyledButton as MantineUnstyledButton } from "@mantine/core";
import type { UIUnstyledButtonProps } from "../types";

export function UnstyledButton({ children, className, style, onClick, "data-testid": testId, ...rest }: UIUnstyledButtonProps) {
  return <MantineUnstyledButton className={className} style={style} onClick={onClick} data-testid={testId} {...rest}>{children}</MantineUnstyledButton>;
}

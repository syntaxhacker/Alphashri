import { Button as MantineButton } from "@mantine/core";
import type { UIButtonProps } from "../types";

export function Button({ children, leftSection, rightSection, className, style, onClick, "data-testid": testId, ...rest }: UIButtonProps) {
  return <MantineButton leftSection={leftSection} rightSection={rightSection} className={className} style={style} onClick={onClick} data-testid={testId} {...rest}>{children}</MantineButton>;
}

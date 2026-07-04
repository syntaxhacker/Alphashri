import { CloseButton as MantineCloseButton } from "@mantine/core";
import type { UICloseButtonProps } from "../types";

export function CloseButton({ size, variant, disabled, onClick, className, style, "data-testid": testId, ...rest }: UICloseButtonProps) {
  return <MantineCloseButton size={size} variant={variant} disabled={disabled} onClick={onClick} className={className} style={style} data-testid={testId} {...rest} />;
}

import { Alert as MantineAlert } from "@mantine/core";
import type { UIAlertProps } from "../types";

export function Alert({ icon, title, withCloseButton, onClose, children, className, style, "data-testid": testId, ...rest }: UIAlertProps) {
  return <MantineAlert icon={icon} title={title} withCloseButton={withCloseButton} onClose={onClose} className={className} style={style} data-testid={testId} {...rest}>{children}</MantineAlert>;
}

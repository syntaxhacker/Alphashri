import { Modal as MantineModal } from "@mantine/core";
import type { UIModalProps } from "../types";

export function Modal({ children, opened, onClose, title, overlayProps, transitionProps, className, style, "data-testid": testId, ...rest }: UIModalProps) {
  return <MantineModal opened={opened} onClose={onClose} title={title} className={className} style={style} data-testid={testId} overlayProps={overlayProps as any} transitionProps={transitionProps as any} {...rest}>{children}</MantineModal>;
}

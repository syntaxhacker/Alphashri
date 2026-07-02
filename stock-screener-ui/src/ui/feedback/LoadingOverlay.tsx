import { LoadingOverlay as MantineLoadingOverlay } from "@mantine/core";
import type { UILoadingOverlayProps } from "../types";

export function LoadingOverlay({ visible, loaderProps, overlayProps, zIndex, className, style, "data-testid": testId, ...rest }: UILoadingOverlayProps) {
  return <MantineLoadingOverlay visible={visible} loaderProps={loaderProps} overlayProps={overlayProps} zIndex={zIndex} className={className} style={style} data-testid={testId} {...rest} />;
}

import { Loader as MantineLoader } from "@mantine/core";
import type { UILoaderProps } from "../types";

export function Loader({ className, style, "data-testid": testId, ...rest }: UILoaderProps) {
  return <MantineLoader className={className} style={style} data-testid={testId} {...rest} />;
}

import { Progress as MantineProgress } from "@mantine/core";
import type { UIProgressProps } from "../types";

export function Progress({ value, color, size, radius, striped, animated, label, sections, transitionDuration, className, style, "data-testid": testId, ...rest }: UIProgressProps) {
  return <MantineProgress value={value} color={color} size={size} radius={radius} striped={striped} animated={animated} label={label} sections={sections} transitionDuration={transitionDuration} className={className} style={style} data-testid={testId} {...rest} />;
}

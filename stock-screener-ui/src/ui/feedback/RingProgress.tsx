import { RingProgress as MantineRingProgress } from "@mantine/core";
import type { UIBaseProps, UIColor } from "../types";

export interface UIRingProgressProps extends UIBaseProps {
  value: number;
  size?: number;
  thickness?: number;
  roundCaps?: boolean;
  color?: UIColor;
  label?: React.ReactNode;
  sections?: { value: number; color: UIColor; tooltip?: string }[];
}

export function RingProgress({ sections, color, value, label, size, thickness, roundCaps, className, style, "data-testid": testId }: UIRingProgressProps) {
  if (sections) {
    return <MantineRingProgress sections={sections as any} label={label} size={size} thickness={thickness} roundCaps={roundCaps} className={className} style={style} data-testid={testId} />;
  }
  return <MantineRingProgress sections={[{ value, color: color as string }]} label={label} size={size} thickness={thickness} roundCaps={roundCaps} className={className} style={style} data-testid={testId} />;
}

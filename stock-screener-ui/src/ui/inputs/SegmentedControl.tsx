import { SegmentedControl as MantineSegmentedControl } from "@mantine/core";
import type { UISegmentedControlProps } from "../types";

export function SegmentedControl({ value, defaultValue, onChange, data, color, size, fullWidth, withItemsBorders, className, style, "data-testid": testId, ...rest }: UISegmentedControlProps) {
  return <MantineSegmentedControl
    value={value}
    defaultValue={defaultValue}
    onChange={onChange}
    data={data}
    color={color}
    size={size}
    fullWidth={fullWidth}
    withItemsBorders={withItemsBorders}
    className={className}
    style={style}
    data-testid={testId}
    {...rest}
  />;
}

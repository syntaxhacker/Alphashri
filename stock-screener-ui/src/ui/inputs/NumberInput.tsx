import { NumberInput as MantineNumberInput } from "@mantine/core";
import type { UINumberInputProps } from "../types";

export function NumberInput({ value, defaultValue, onChange, min, max, step, decimalScale, clampBehavior, allowDecimal, allowNegative, hideControls, suffix, prefix, leftSection, rightSection, label, description, error, required, disabled, size, placeholder, className, style, "data-testid": testId, ...rest }: UINumberInputProps) {
  return <MantineNumberInput
    value={value}
    defaultValue={defaultValue}
    onChange={onChange}
    min={min}
    max={max}
    step={step}
    decimalScale={decimalScale}
    clampBehavior={clampBehavior}
    allowDecimal={allowDecimal}
    allowNegative={allowNegative}
    hideControls={hideControls}
    suffix={suffix}
    prefix={prefix}
    leftSection={leftSection}
    rightSection={rightSection}
    label={label}
    description={description}
    error={error}
    required={required}
    disabled={disabled}
    size={size}
    placeholder={placeholder}
    className={className}
    style={style}
    data-testid={testId}
    {...rest}
  />;
}

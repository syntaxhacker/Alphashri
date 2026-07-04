import { Select as MantineSelect } from "@mantine/core";
import type { UISelectProps } from "../types";

export function Select({ value, defaultValue, onChange, data, searchable, clearable, leftSection, rightSection, nothingFoundMessage, placeholder, label, description, error, required, disabled, size, className, style, "data-testid": testId, ...rest }: UISelectProps) {
  return <MantineSelect
    value={value}
    defaultValue={defaultValue}
    onChange={onChange}
    data={data}
    searchable={searchable}
    clearable={clearable}
    leftSection={leftSection}
    rightSection={rightSection}
    nothingFoundMessage={nothingFoundMessage}
    placeholder={placeholder}
    label={label}
    description={description}
    error={error}
    required={required}
    disabled={disabled}
    size={size}
    className={className}
    style={style}
    data-testid={testId}
    {...rest}
  />;
}

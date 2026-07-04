import { MultiSelect as MantineMultiSelect } from "@mantine/core";
import type { UIMultiSelectProps } from "../types";

export function MultiSelect({ value, defaultValue, onChange, data, searchable, clearable, placeholder, nothingFoundMessage, leftSection, rightSection, maxValues, hidePickedOptions, label, description, error, required, disabled, size, className, style, "data-testid": testId, ...rest }: UIMultiSelectProps) {
  return <MantineMultiSelect
    value={value}
    defaultValue={defaultValue}
    onChange={onChange}
    data={data}
    searchable={searchable}
    clearable={clearable}
    placeholder={placeholder}
    nothingFoundMessage={nothingFoundMessage}
    leftSection={leftSection}
    rightSection={rightSection}
    maxValues={maxValues}
    hidePickedOptions={hidePickedOptions}
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

import { useMemo } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Chip from "@mui/material/Chip";
import type { UIMultiSelectProps } from "../types";

type Option = { value: string; label: string; disabled?: boolean };

function normalizeOptions(data: UIMultiSelectProps["data"]): Option[] {
  if (!data) return [];
  return data.map((item) =>
    typeof item === "string" ? { value: item, label: item } : { value: item.value, label: item.label, disabled: item.disabled },
  );
}

function mapSize(size?: UIMultiSelectProps["size"]): "small" | "medium" {
  return size === "xs" || size === "sm" ? "small" : "medium";
}

export function MultiSelect({
  value,
  defaultValue,
  onChange,
  data,
  searchable: _searchable,
  clearable,
  placeholder,
  nothingFoundMessage,
  leftSection,
  rightSection,
  maxValues,
  hidePickedOptions,
  label,
  description,
  error,
  required,
  disabled,
  size,
  className,
  style,
  "data-testid": testId,
  ...rest
}: UIMultiSelectProps) {
  const options = useMemo(() => normalizeOptions(data), [data]);
  const muiSize = mapSize(size);
  const isError = Boolean(error);
  const helperText = isError
    ? typeof error === "string"
      ? error
      : String(error ?? "")
    : (description as string | undefined);

  const controlledValue = useMemo(() => {
    if (value === undefined) return undefined;
    return options.filter((o) => value.includes(o.value));
  }, [value, options]);

  const defaultVal = useMemo(() => {
    if (defaultValue === undefined) return undefined;
    return options.filter((o) => defaultValue.includes(o.value));
  }, [defaultValue, options]);

  return (
    <Autocomplete
      multiple
      options={options}
      value={controlledValue}
      defaultValue={defaultVal as Option[] | undefined}
      onChange={(_e, newVal) => {
        let vals = (newVal as Option[]).map((o) => o.value);
        if (maxValues !== undefined && vals.length > maxValues) {
          vals = vals.slice(0, maxValues);
        }
        onChange?.(vals);
      }}
      getOptionLabel={(opt) => (typeof opt === "string" ? opt : opt.label)}
      isOptionEqualToValue={(opt, val) => opt.value === val.value}
      getOptionDisabled={(opt) => Boolean(opt.disabled)}
      filterSelectedOptions={hidePickedOptions}
      disabled={disabled}
      clearOnEscape={Boolean(clearable)}
      noOptionsText={nothingFoundMessage ?? "No options"}
      className={className}
      style={style as React.CSSProperties}
      data-testid={testId}
      renderTags={(tagValue, getTagProps) =>
        tagValue.map((option, index) => (
          <Chip label={option.label} size={muiSize} {...getTagProps({ index })} key={option.value} />
        ))
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label as string | undefined}
          placeholder={placeholder}
          helperText={helperText}
          error={isError}
          required={required}
          size={muiSize}
          InputProps={{
            ...params.InputProps,
            startAdornment: (
              <>
                {leftSection ? <InputAdornment position="start">{leftSection}</InputAdornment> : null}
                {params.InputProps.startAdornment}
              </>
            ),
            endAdornment: (
              <>
                {params.InputProps.endAdornment}
                {rightSection ? <InputAdornment position="end">{rightSection}</InputAdornment> : null}
              </>
            ),
          }}
          sx={{ "& .MuiInputBase-root": { bgcolor: "background.paper" } }}
        />
      )}
      sx={{ width: "100%" }}
      {...(rest as object)}
    />
  );
}

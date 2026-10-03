import { useMemo, useRef } from "react";
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
  searchValue,
  onSearchChange,
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
  const { w: widthProp, h: heightProp, ...restProps } = rest as {
    w?: number | string;
    h?: number | string;
  } & Record<string, unknown>;
  const explicitWidth = widthProp != null ? (typeof widthProp === "number" ? `${widthProp}px` : widthProp) : undefined;
  const explicitHeight = heightProp != null ? (typeof heightProp === "number" ? `${heightProp}px` : heightProp) : undefined;
  const helperText = isError
    ? typeof error === "string"
      ? error
      : String(error ?? "")
    : (description as string | undefined);

  const controlledValueRaw = useMemo(() => {
    if (value === undefined) return undefined;
    // Union the current options with the selected values, so a symbol chosen
    // earlier is never dropped when the latest async search page doesn't
    // include it (which used to make chips vanish and reset the input).
    const byValue = new Map(options.map((o) => [o.value, o]));
    return value.map((v) => byValue.get(v) ?? { value: v, label: v });
  }, [value, options]);

  // Keep a stable array identity while the content is unchanged: MUI treats a
  // new `value` reference as a value change and emits `onInputChange("", "reset")`,
  // which wiped the search text on every async options load.
  const controlledValueRef = useRef<Option[] | undefined>(undefined);
  const controlledValue = useMemo(() => {
    const next = controlledValueRaw;
    const prev = controlledValueRef.current;
    if (
      prev &&
      next &&
      prev.length === next.length &&
      prev.every((o, i) => o.value === next[i].value && o.label === next[i].label)
    ) {
      return prev;
    }
    controlledValueRef.current = next;
    return next;
  }, [controlledValueRaw]);

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
      inputValue={searchValue}
      onInputChange={(_e, v, reason) => {
        // Forward only genuine search edits. MUI also fires onInputChange with
        // an empty string and reasons "reset" (value/options identity change),
        // "blur" (clearOnBlur), "selectOption"/"removeOption" — forwarding those
        // wiped callers' typed query.
        if (reason === "input" || reason === "clear") onSearchChange?.(v, reason);
      }}
      filterOptions={(x) => x}
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
            ...(params.InputProps ?? {}),
            startAdornment: (
              <>
                {leftSection ? <InputAdornment position="start">{leftSection}</InputAdornment> : null}
                {params.InputProps?.startAdornment}
              </>
            ),
            endAdornment: (
              <>
                {params.InputProps?.endAdornment}
                {rightSection ? <InputAdornment position="end">{rightSection}</InputAdornment> : null}
              </>
            ),
          }}
          sx={{ "& .MuiInputBase-root": { bgcolor: "background.paper" } }}
        />
      )}
      sx={{ width: explicitWidth ?? "100%", ...(explicitHeight && { height: explicitHeight }) }}
      {...(restProps as object)}
    />
  );
}

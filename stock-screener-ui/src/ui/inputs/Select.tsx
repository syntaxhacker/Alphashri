import { useId, useMemo } from "react";
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import InputAdornment from "@mui/material/InputAdornment";
import InputLabel from "@mui/material/InputLabel";
import MuiSelect from "@mui/material/Select";
import type { SelectChangeEvent } from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import IconButton from "@mui/material/IconButton";
import ClearIcon from "@mui/icons-material/Clear";
import type { UISelectProps } from "../types";

type SelectOption = { value: string; label: string; disabled?: boolean };

function normalizeOptions(data: UISelectProps["data"]): SelectOption[] {
  if (!data) return [];
  return data.map((item) =>
    typeof item === "string" ? { value: item, label: item } : { value: item.value, label: item.label, disabled: item.disabled },
  );
}

function mapSize(size?: UISelectProps["size"]): "small" | "medium" {
  return size === "xs" || size === "sm" ? "small" : "medium";
}

export function Select({
  value,
  defaultValue,
  onChange,
  data,
  searchable: _searchable,
  clearable,
  leftSection,
  rightSection,
  nothingFoundMessage,
  placeholder,
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
}: UISelectProps) {
  const autoId = useId();
  const labelId = label ? `${autoId}-label` : undefined;
  const options = useMemo(() => normalizeOptions(data), [data]);
  const muiSize = mapSize(size);
  const isError = Boolean(error);
  const helperText = isError ? (typeof error === "string" ? error : String(error ?? "")) : (description as string | undefined);
  // MUI Select uses "" for empty; normalize null -> ""
  const controlledValue = value !== undefined ? (value ?? "") : undefined;
  const controlledDefaultValue = defaultValue !== undefined ? (defaultValue ?? "") : undefined;

  const handleChange = (event: SelectChangeEvent<string>) => {
    const v = event.target.value;
    onChange?.(v === "" ? null : v);
  };

  const showClear = Boolean(clearable && (value ?? defaultValue) && !disabled);

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange?.(null);
  };

  return (
    <FormControl
      fullWidth
      size={muiSize}
      error={isError}
      required={required}
      disabled={disabled}
      className={className}
      style={style as React.CSSProperties}
      data-testid={testId}
      sx={{ minWidth: 120 }}
      {...(rest as object)}
    >
      {label && (
        <InputLabel id={labelId} required={required}>
          {label}
        </InputLabel>
      )}
      <MuiSelect
        labelId={labelId}
        value={controlledValue as string | undefined}
        defaultValue={controlledDefaultValue as string | undefined}
        onChange={handleChange}
        displayEmpty={Boolean(placeholder)}
        label={label as string | undefined}
        disabled={disabled}
        error={isError}
        size={muiSize}
        startAdornment={
          leftSection ? <InputAdornment position="start">{leftSection}</InputAdornment> : undefined
        }
        endAdornment={
          (showClear || rightSection) ? (
            <InputAdornment position="end" sx={{ mr: 1, display: "flex", alignItems: "center", gap: 0.5 }}>
              {showClear && (
                <IconButton
                  aria-label="clear"
                  size="small"
                  onClick={handleClear}
                  onMouseDown={(e) => e.stopPropagation()}
                  edge="end"
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              )}
              {rightSection}
            </InputAdornment>
          ) : undefined
        }
        renderValue={(selected) => {
          if (selected === "" || selected == null) {
            return <span style={{ opacity: 0.6 }}>{placeholder ?? ""}</span>;
          }
          const found = options.find((o) => o.value === selected);
          return found ? found.label : String(selected);
        }}
      >
        {placeholder && (
          <MenuItem value="" disabled={!clearable}>
            <em>{placeholder}</em>
          </MenuItem>
        )}
        {options.length === 0 ? (
          <MenuItem disabled value="__empty__">
            {nothingFoundMessage ?? "No options"}
          </MenuItem>
        ) : (
          options.map((opt) => (
            <MenuItem key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </MenuItem>
          ))
        )}
      </MuiSelect>
      {helperText && (
        <FormHelperText error={isError} sx={{ mx: 0, mt: 0.5 }}>
          {helperText}
        </FormHelperText>
      )}
    </FormControl>
  );
}

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "../cn";
import type { UIMultiSelectProps } from "../types";

type Option = { value: string; label: string; disabled?: boolean };

function normalizeOptions(data: UIMultiSelectProps["data"]): Option[] {
  if (!data) return [];
  return data.map((item) =>
    typeof item === "string" ? { value: item, label: item } : { value: item.value, label: item.label, disabled: item.disabled },
  );
}

function controlClasses(size?: UIMultiSelectProps["size"], disabled?: boolean, error?: boolean): string {
  return cn(
    "border rounded-fin bg-fin-surface text-fin-text outline-none",
    size === "xs" || size === "sm" ? "text-xs px-2 py-1.5" : "text-sm px-3 py-2",
    disabled ? "opacity-50 cursor-not-allowed" : "",
    error ? "border-fin-negative" : "border-fin-border",
    "focus-visible:ring-1 focus-visible:ring-fin-primary",
  );
}

function labelClasses(size?: UIMultiSelectProps["size"]): string {
  return cn("font-medium text-fin-text", size === "xs" || size === "sm" ? "text-xs" : "text-sm");
}

function helperTextClasses(error?: boolean): string {
  return cn("text-xs leading-none", error ? "text-fin-negative" : "text-fin-text-muted");
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
  hideTags,
  label,
  description,
  error,
  required,
  disabled,
  size,
  className,
  style,
  id,
  w,
  h,
  "data-testid": testId,
  // Legacy Mantine-isms — accepted for backward compat, never forwarded.
  allowDeselect: _allowDeselect,
  maxDropdownHeight: _maxDropdownHeight,
  comboboxProps: _comboboxProps,
  withinPortal: _withinPortal,
  InputProps: _InputProps,
}: UIMultiSelectProps) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-multiselect`;
  const labelId = label ? `${inputId}-label` : undefined;
  const explicitWidth = w != null ? (typeof w === "number" ? `${w}px` : w) : undefined;
  const explicitHeight = h != null ? (typeof h === "number" ? `${h}px` : h) : undefined;
  const options = useMemo(() => normalizeOptions(data), [data]);
  const isError = Boolean(error);
  const rootRef = useRef<HTMLDivElement>(null);
  const helperText = isError
    ? typeof error === "string"
      ? error
      : String(error ?? "")
    : (description as string | undefined);

  const rootClass = cn(
    "flex flex-col gap-2 text-sm leading-none",
    explicitWidth == null ? "w-full" : undefined,
    className,
  );
  const rootStyle = {
    ...(style as React.CSSProperties),
    ...(explicitWidth != null ? { width: explicitWidth } : {}),
    ...(explicitHeight != null ? { height: explicitHeight } : {}),
  };
  const labelClass = labelClasses(size);
  const helperTextClass = helperTextClasses(isError);

  const [internalSelected, setInternalSelected] = useState<string[]>(() =>
    (defaultValue ?? []).filter((v) => options.some((o) => o.value === v)),
  );
  const [query, setQuery] = useState(searchValue ?? "");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selectedValues = value ?? internalSelected;
  const selectedSet = new Set(selectedValues);
  const byValue = new Map(options.map((o) => [o.value, o]));

  // Union caller-selected values with the current options so a value chosen
  // earlier is never dropped when the latest options page omits it.
  const shownOptions = useMemo(() => {
    const shown = [...options];
    selectedValues.forEach((v) => {
      if (!byValue.has(v)) shown.push({ value: v, label: v });
    });
    return hidePickedOptions ? shown.filter((o) => !selectedSet.has(o.value)) : shown;
  }, [options, selectedValues, selectedSet, byValue, hidePickedOptions]);

  const toggle = useCallback(
    (v: string) => {
      if (disabled) return;
      const next = selectedSet.has(v) ? selectedValues.filter((x) => x !== v) : [...selectedValues, v];
      const capped = maxValues !== undefined && next.length > maxValues ? next.slice(0, maxValues) : next;
      if (value === undefined) setInternalSelected(capped);
      onChange?.(capped);
    },
    [disabled, selectedValues, selectedSet, maxValues, value, onChange],
  );

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (open && rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open, rootRef]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setQuery(next);
    setOpen(true);
    onSearchChange?.(next, "input");
  };

  const handleClearSearch = () => {
    if (query === "") return;
    setQuery("");
    onSearchChange?.("", "clear");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      handleClearSearch();
      setOpen(false);
      return;
    }
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((p) => Math.min(p + 1, Math.max(shownOptions.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((p) => Math.max(p - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = shownOptions[highlighted];
      if (option && !option.disabled) toggle(option.value);
    }
  };

  const tagClass = "inline-flex items-center gap-1.5 border rounded-fin px-2 py-0.5 text-xs text-fin-text border-fin-border bg-fin-surface-alt";

  return (
    <div ref={rootRef} className={rootClass} data-testid={testId} style={rootStyle}>
      {label && (
        <label id={labelId} htmlFor={inputId} className={labelClass}>
          {label}
          {required && <span className="text-fin-negative"> *</span>}
        </label>
      )}
      <div className="relative w-full">
        {!hideTags && selectedValues.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {selectedValues.map((v) => (
              <span key={v} className={tagClass}>
                {byValue.get(v)?.label ?? v}
                {clearable && !disabled && (
                  <button
                    type="button"
                    aria-label={`Remove ${v}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(v);
                    }}
                    className="shrink-0 p-0.5 text-fin-text-muted hover:bg-fin-surface rounded-fin"
                  >
                    &times;
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        <div className="inline-flex w-full items-center gap-2">
          {leftSection && <span className="shrink-0 text-fin-text-muted text-xs">{leftSection}</span>}
          <input
            ref={inputRef}
            id={inputId}
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-multiselectable="true"
            value={searchValue ?? query}
            onChange={handleInputChange}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            required={required}
            placeholder={placeholder}
            className={controlClasses(size, disabled, isError)}
          />
          {rightSection && <span className="shrink-0">{rightSection}</span>}
        </div>
        {open && (
          <ul role="listbox" className="absolute z-50 left-0 right-0 mt-1 border border-fin-border rounded-fin bg-fin-surface text-fin-text max-h-60 overflow-y-auto outline-none">
            {shownOptions.length === 0 ? (
              <li role="option" aria-disabled className="px-3 py-2 text-xs text-fin-text-muted">
                {nothingFoundMessage ?? "No options"}
              </li>
            ) : (
              shownOptions.map((opt) => (
                <li key={opt.value} role="option" aria-selected={selectedSet.has(opt.value)} aria-disabled={opt.disabled || disabled}>
                  <label className="flex items-center gap-2 cursor-pointer select-none w-full px-3 py-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed">
                    <input
                      type="checkbox"
                      checked={selectedSet.has(opt.value)}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggle(opt.value);
                      }}
                      disabled={opt.disabled || disabled}
                      className="shrink-0 text-fin-primary"
                    />
                    {opt.label}
                  </label>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      {helperText && <p className={helperTextClass}>{helperText}</p>}
    </div>
  );
}

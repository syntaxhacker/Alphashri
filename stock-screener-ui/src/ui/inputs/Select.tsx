import { Children, Fragment, isValidElement, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "../cn";
import type { UISelectProps } from "../types";

type SelectOption = { value: string; label: string; disabled?: boolean };

function normalizeOptions(data: UISelectProps["data"]): SelectOption[] {
  if (!data) return [];
  return data.map((item) =>
    typeof item === "string" ? { value: item, label: item } : { value: item.value, label: item.label, disabled: item.disabled },
  );
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

function optionsFromChildren(children: ReactNode): SelectOption[] {
  const out: SelectOption[] = [];
  const walk = (node: ReactNode) => {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      if (child.type === Fragment) {
        walk((child.props as { children?: ReactNode }).children);
        return;
      }
      const props = child.props as { value?: unknown; disabled?: boolean; children?: ReactNode };
      if (props.value === undefined) return;
      out.push({
        value: String(props.value),
        label: textOf(props.children),
        disabled: Boolean(props.disabled),
      });
    });
  };
  walk(children);
  return out;
}

function controlClasses(size?: UISelectProps["size"], disabled?: boolean, error?: boolean): string {
  return cn(
    "flex-1 min-w-0 border rounded-fin bg-fin-surface text-fin-text outline-none",
    size === "xs" || size === "sm" ? "text-xs px-2 py-1.5" : "text-sm px-3 py-2",
    disabled ? "opacity-50 cursor-not-allowed" : "",
    error ? "border-fin-negative" : "border-fin-border",
    "focus-visible:ring-1 focus-visible:ring-fin-primary",
  );
}

function labelClasses(size?: UISelectProps["size"]): string {
  return cn("font-medium text-fin-text", size === "xs" || size === "sm" ? "text-xs" : "text-sm");
}

function helperTextClasses(error?: boolean): string {
  return cn("text-xs leading-none", error ? "text-fin-negative" : "text-fin-text-muted");
}

export function Select({
  value,
  defaultValue,
  onChange,
  data,
  children,
  searchable,
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
  name,
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
}: UISelectProps) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-select`;
  const labelId = label ? `${inputId}-label` : undefined;
  const explicitWidth = w != null ? (typeof w === "number" ? `${w}px` : w) : undefined;
  const explicitHeight = h != null ? (typeof h === "number" ? `${h}px` : h) : undefined;
  const options = useMemo(
    () => (data && data.length > 0 ? normalizeOptions(data) : optionsFromChildren(children)),
    [data, children],
  );
  const isError = Boolean(error);
  const rootRef = useRef<HTMLDivElement>(null);
  const isControlled = value !== undefined || (onChange !== undefined && defaultValue === undefined);
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
    ...(style as CSSProperties),
    ...(explicitWidth != null ? { width: explicitWidth } : {}),
    ...(explicitHeight != null ? { height: explicitHeight } : {}),
  };
  const labelClass = labelClasses(size);
  const helperTextClass = helperTextClasses(isError);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange?.(e.target.value === "" ? null : e.target.value);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange?.(null);
  };

  const showClear = Boolean(clearable && (value ?? defaultValue) && !disabled);

  const adornments = (
    <div className="inline-flex w-full items-center gap-2">
      {leftSection && <span className="shrink-0 text-fin-text-muted text-xs">{leftSection}</span>}
      <select
        id={inputId}
        name={name as string | undefined}
        value={isControlled ? String(value ?? "") : undefined}
        defaultValue={isControlled ? undefined : defaultValue != null ? String(defaultValue) : undefined}
        onChange={handleChange}
        disabled={disabled}
        required={required}
        className={controlClasses(size, disabled, isError)}
      >
        {placeholder && <option value="" disabled hidden>{placeholder}</option>}
        {options.length === 0 ? (
          <option disabled value="">{nothingFoundMessage ?? "No options"}</option>
        ) : (
          options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))
        )}
      </select>
      {showClear && (
        <button type="button" aria-label="clear" onClick={handleClear} onMouseDown={(e) => e.stopPropagation()} className="shrink-0 p-1 text-fin-text-muted hover:bg-fin-surface-alt rounded-fin">
          &times;
        </button>
      )}
      {rightSection && <span className="shrink-0">{rightSection}</span>}
    </div>
  );

  const control = searchable ? (
    <SearchableSelect
      rootRef={rootRef}
      options={options}
      value={value}
      onChange={onChange}
      disabled={disabled}
      size={size}
      clearable={clearable}
      placeholder={placeholder}
      nothingFoundMessage={nothingFoundMessage}
      inputId={inputId}
      labelId={labelId}
      isError={isError}
      leftSection={leftSection}
      rightSection={rightSection}
    />
  ) : (
    adornments
  );

  return (
    <div ref={rootRef} className={rootClass} data-testid={testId} style={rootStyle}>
      {label && (
        <label id={labelId} htmlFor={inputId} className={labelClass}>
          {label}
          {required && <span className="text-fin-negative"> *</span>}
        </label>
      )}
      {control}
      {helperText && <p className={helperTextClass}>{helperText}</p>}
    </div>
  );
}

function SearchableSelect({
  rootRef,
  options,
  value,
  onChange,
  disabled,
  size,
  clearable,
  placeholder,
  nothingFoundMessage,
  inputId,
  isError,
  leftSection,
  rightSection,
}: {
  rootRef: React.RefObject<HTMLDivElement>;
  options: SelectOption[];
  value: string | null | undefined;
  onChange?: (value: string | null) => void;
  disabled?: boolean;
  size?: string;
  clearable?: boolean;
  placeholder?: string;
  nothingFoundMessage?: string;
  inputId: string;
  labelId: string | undefined;
  isError: boolean;
  leftSection?: React.ReactNode;
  rightSection?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = `${inputId}-listbox`;

  const filtered = useMemo(
    () =>
      options.filter(
        (o) => o.label.toLowerCase().includes(query.toLowerCase()) || o.value.toLowerCase().includes(query.toLowerCase()),
      ),
    [options, query],
  );
  const selectedLabel = options.find((o) => o.value === value)?.label;
  const displayValue = selectedLabel ?? query ?? "";

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (open && rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open, rootRef]);

  const handleSelect = (v: string) => {
    setOpen(false);
    const found = options.find((o) => o.value === v);
    setQuery(found ? found.label : v);
    onChange?.(v);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setQuery("");
    setOpen(false);
    onChange?.(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open) {
      if (e.key === "ArrowDown") setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((p) => Math.min(p + 1, Math.max(filtered.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((p) => Math.max(p - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (highlighted >= 0) {
        handleSelect(filtered[highlighted].value);
      } else if (filtered.length === 1) {
        handleSelect(filtered[0].value);
      }
      setOpen(false);
    }
  };

  return (
    <div className="w-full" onMouseDown={(e) => e.stopPropagation()}>
      <div className="relative w-full">
        <div className="inline-flex w-full items-center gap-2">
          {leftSection && <span className="shrink-0 text-fin-text-muted text-xs">{leftSection}</span>}
          <input
            ref={inputRef}
            id={inputId}
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={listboxId}
            aria-multiselectable="false"
            value={displayValue}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={placeholder}
            className={controlClasses(size, disabled, isError)}
          />
          {clearable && displayValue && !disabled && (
            <button type="button" aria-label="clear" onClick={handleClear} onMouseDown={(e) => e.stopPropagation()} className="shrink-0 p-1 text-fin-text-muted hover:bg-fin-surface-alt rounded-fin">
              &times;
            </button>
          )}
          {rightSection && <span className="shrink-0">{rightSection}</span>}
        </div>
        {open && (
          <ul id={listboxId} role="listbox" className="absolute z-50 left-0 right-0 mt-1 border border-fin-border rounded-fin bg-fin-surface text-fin-text max-h-48 overflow-y-auto outline-none">
            {filtered.length === 0 ? (
              <li role="option" aria-disabled className="px-3 py-2 text-xs text-fin-text-muted">
                {nothingFoundMessage ?? "No options"}
              </li>
            ) : (
              filtered.map((opt, i) => (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === value}
                  aria-disabled={opt.disabled || undefined}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (!opt.disabled && !disabled) handleSelect(opt.value);
                  }}
                  className={cn(
                    "px-3 py-2 text-xs cursor-pointer select-none",
                    opt.value === value ? "bg-fin-primary text-white" : "",
                    highlighted === i ? "bg-fin-surface-alt" : "",
                    opt.disabled ? "text-fin-text-muted opacity-50" : "",
                  )}
                >
                  {opt.label}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

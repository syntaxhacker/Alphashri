import { createMemo, createUniqueId, createEffect, For, Show, splitProps } from "solid-js";
import { cn } from "../cn";
import type { UISelectProps } from "../types";

type SelectOption = { value: string; label: string; disabled?: boolean };

function normalizeOptions(data: UISelectProps["data"]): SelectOption[] {
  if (!data) return [];
  return data.map((item) =>
    typeof item === "string" ? { value: item, label: item } : { value: item.value, label: item.label, disabled: item.disabled },
  );
}

function textOf(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  const el = node as { props?: { children?: unknown } };
  return textOf(el.props?.children);
}

function optionsFromChildren(children: unknown): SelectOption[] {
  const out: SelectOption[] = [];
  const node = typeof children === "function" ? (children as () => unknown)() : children;
  const walk = (n: unknown) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== "object") return;
    const el = n as { type?: unknown; props?: { value?: unknown; disabled?: boolean; children?: unknown } };
    if (el.props && el.props.value !== undefined) {
      out.push({ value: String(el.props.value), label: textOf(el.props.children), disabled: Boolean(el.props.disabled) });
    }
    if (el.props?.children) walk(el.props.children);
  };
  walk(node);
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

export function Select(props: UISelectProps) {
  const [known, _rest] = splitProps(props, [
    "value",
    "defaultValue",
    "onChange",
    "data",
    "children",
    "searchable",
    "clearable",
    "leftSection",
    "rightSection",
    "nothingFoundMessage",
    "placeholder",
    "label",
    "description",
    "error",
    "required",
    "disabled",
    "size",
    "className",
    "style",
    "name",
    "id",
    "w",
    "h",
    "data-testid",
    "allowDeselect",
    "maxDropdownHeight",
    "comboboxProps",
    "withinPortal",
    "InputProps",
  ]);

  const inputId = known.id ?? createUniqueId();
  const labelId = known.label ? `${inputId}-label` : undefined;
  const explicitWidth = known.w != null ? (typeof known.w === "number" ? `${known.w}px` : known.w) : undefined;
  const explicitHeight = known.h != null ? (typeof known.h === "number" ? `${known.h}px` : known.h) : undefined;
  const options = createMemo(() => (known.data && known.data.length > 0 ? normalizeOptions(known.data) : optionsFromChildren(known.children)));
  const isError = Boolean(known.error);
  let rootEl: HTMLDivElement | undefined;
  const isControlled = known.value !== undefined || (known.onChange !== undefined && known.defaultValue === undefined);
  const helperText = isError
    ? typeof known.error === "string"
      ? known.error
      : String(known.error ?? "")
    : (known.description as string | undefined);

  const rootClass = cn(
    "flex flex-col gap-2 text-sm leading-none",
    explicitWidth == null ? "w-full" : undefined,
    known.className,
  );
  const rootStyle = {
    ...known.style,
    ...(explicitWidth != null ? { width: explicitWidth } : {}),
    ...(explicitHeight != null ? { height: explicitHeight } : {}),
  };
  const labelClass = labelClasses(known.size);
  const helperTextClass = helperTextClasses(isError);

  const handleChange = (e: Event) => {
    const target = e.currentTarget as HTMLSelectElement;
    known.onChange?.(target.value === "" ? null : target.value);
  };

  const handleClear = (e: MouseEvent) => {
    e.stopPropagation();
    known.onChange?.(null);
  };

  const showClear = known.clearable && (known.value ?? known.defaultValue) != null && !known.disabled;

  const adornments = (
    <div className="inline-flex w-full items-center gap-2">
      {known.leftSection && <span className="shrink-0 text-fin-text-muted text-xs">{known.leftSection}</span>}
      <select
        id={inputId}
        name={known.name as string | undefined}
        value={isControlled ? String(known.value ?? "") : undefined}
        defaultValue={isControlled ? undefined : known.defaultValue != null ? String(known.defaultValue) : undefined}
        onInput={handleChange}
        disabled={known.disabled}
        required={known.required}
        className={controlClasses(known.size, known.disabled, isError)}
      >
        {known.placeholder && <option value="" disabled hidden>{known.placeholder}</option>}
        <Show when={options().length === 0}>
          <option disabled value="">{known.nothingFoundMessage ?? "No options"}</option>
        </Show>
        <Show when={options().length > 0}>
          <For each={options()}>{(opt) => (
            <option value={opt.value} disabled={opt.disabled || undefined}>
              {opt.label}
            </option>
          )}</For>
        </Show>
      </select>
      {showClear && (
        <button type="button" aria-label="clear" onClick={handleClear} onMouseDown={(e) => e.stopPropagation()} className="shrink-0 p-1 text-fin-text-muted hover:bg-fin-surface-alt rounded-fin">
          &times;
        </button>
      )}
      {known.rightSection && <span className="shrink-0">{known.rightSection}</span>}
    </div>
  );

  const control = known.searchable ? (
    <SearchableSelect
      rootRef={() => rootEl}
      options={options()}
      value={known.value}
      onChange={(v) => known.onChange?.(v)}
      disabled={known.disabled}
      size={known.size}
      clearable={known.clearable}
      placeholder={known.placeholder}
      nothingFoundMessage={known.nothingFoundMessage}
      inputId={inputId}
      labelId={labelId}
      isError={isError}
      leftSection={known.leftSection}
      rightSection={known.rightSection}
    />
  ) : (
    adornments
  );

  return (
    <div ref={(el) => (rootEl = el)} className={rootClass} data-testid={known["data-testid"]} style={rootStyle}>
      {known.label && (
        <label id={labelId} htmlFor={inputId} className={labelClass}>
          {known.label}
          {known.required && <span className="text-fin-negative"> *</span>}
        </label>
      )}
      {control}
      {helperText && <p className={helperTextClass}>{helperText}</p>}
    </div>
  );
}

function SearchableSelect(props: {
  rootRef: () => HTMLDivElement | undefined;
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
  leftSection?: unknown;
  rightSection?: unknown;
}) {
  const [query, setQuery] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const [highlighted, setHighlighted] = createSignal(-1);
  let inputEl: HTMLInputElement | null = null;
  const listboxId = `${props.inputId}-listbox`;

  const filtered = createMemo(() =>
    props.options.filter(
      (o) => o.label.toLowerCase().includes(query().toLowerCase()) || o.value.toLowerCase().includes(query().toLowerCase()),
    ),
  );
  const selectedLabel = props.options.find((o) => o.value === props.value)?.label;
  const displayValue = selectedLabel ?? query() ?? "";

  createEffect(() => {
    if (!open()) return undefined;
    const root = props.rootRef;
    const handleOutside = (e: MouseEvent) => {
      if (open() && root && !root.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  });

  const handleSelect = (v: string) => {
    setOpen(false);
    const found = props.options.find((o) => o.value === v);
    setQuery(found ? found.label : v);
    props.onChange?.(v);
  };

  const handleClear = (e: MouseEvent) => {
    e.stopPropagation();
    setQuery("");
    setOpen(false);
    props.onChange?.(null);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open()) {
      if (e.key === "ArrowDown") setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((p) => Math.min(p + 1, Math.max(filtered().length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((p) => Math.max(p - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (highlighted() >= 0) {
        handleSelect(filtered()[highlighted()].value);
      } else if (filtered().length === 1) {
        handleSelect(filtered()[0].value);
      }
      setOpen(false);
    }
  };

  return (
    <div className="w-full" onMouseDown={(e) => e.stopPropagation()}>
      <div className="relative w-full">
        <div className="inline-flex w-full items-center gap-2">
          {props.leftSection && <span className="shrink-0 text-fin-text-muted text-xs">{props.leftSection}</span>}
          <input
            ref={(el) => (inputEl = el)}
            id={props.inputId}
            role="combobox"
            aria-expanded={open()}
            aria-haspopup="listbox"
            aria-controls={listboxId}
            aria-multiselectable="false"
            value={displayValue}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={handleKeyDown}
            disabled={props.disabled}
            placeholder={props.placeholder}
            className={controlClasses(props.size, props.disabled, props.isError)}
          />
          {props.clearable && displayValue && !props.disabled && (
            <button type="button" aria-label="clear" onClick={handleClear} onMouseDown={(e) => e.stopPropagation()} className="shrink-0 p-1 text-fin-text-muted hover:bg-fin-surface-alt rounded-fin">
              &times;
            </button>
          )}
          {props.rightSection && <span className="shrink-0">{props.rightSection}</span>}
        </div>
        <Show when={open()}>
          <ul id={listboxId} role="listbox" className="absolute z-50 left-0 right-0 mt-1 border border-fin-border rounded-fin bg-fin-surface text-fin-text max-h-48 overflow-y-auto outline-none">
            {filtered().length === 0 ? (
              <li role="option" aria-disabled className="px-3 py-2 text-xs text-fin-text-muted">
                {props.nothingFoundMessage ?? "No options"}
              </li>
            ) : (
              <For each={filtered()}>{(opt, i) => (
                <li
                  role="option"
                  aria-selected={opt.value === props.value}
                  aria-disabled={opt.disabled || props.disabled || undefined}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (!opt.disabled && !props.disabled) handleSelect(opt.value);
                  }}
                  className={cn(
                    "px-3 py-2 text-xs cursor-pointer select-none",
                    opt.value === props.value ? "bg-fin-primary text-white" : "",
                    highlighted() === i ? "bg-fin-surface-alt" : "",
                    opt.disabled ? "text-fin-text-muted opacity-50" : "",
                  )}
                >
                  {opt.label}
                </li>
              )}</For>
            )}
          </ul>
        </Show>
      </div>
    </div>
  );
}

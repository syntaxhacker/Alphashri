import { createMemo, createSignal, createUniqueId, createEffect, For, Show, splitProps } from "solid-js";
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

export function MultiSelect(props: UIMultiSelectProps) {
  const [known, _rest] = splitProps(props, [
    "value",
    "defaultValue",
    "onChange",
    "data",
    "searchable",
    "searchValue",
    "onSearchChange",
    "clearable",
    "placeholder",
    "nothingFoundMessage",
    "leftSection",
    "rightSection",
    "maxValues",
    "hidePickedOptions",
    "hideTags",
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
  const labelId = known.label ? `${inputId}-multiselect-label` : undefined;
  const explicitWidth = known.w != null ? (typeof known.w === "number" ? `${known.w}px` : known.w) : undefined;
  const explicitHeight = known.h != null ? (typeof known.h === "number" ? `${known.h}px` : known.h) : undefined;
  const options = createMemo(() => normalizeOptions(known.data));
  const byValue = createMemo(() => new Map(options().map((o) => [o.value, o])));
  const isError = Boolean(known.error);
  let rootEl: HTMLDivElement | undefined;
  const helperText = isError
    ? typeof known.error === "string"
      ? known.error
      : String(known.error ?? "")
    : (known.description as string | undefined);

  const [internalSelected, setInternalSelected] = createSignal<string[]>(
    (known.defaultValue ?? []).filter((v) => options().some((o) => o.value === v)),
  );
  const [query, setQuery] = createSignal(known.searchValue ?? "");
  const [open, setOpen] = createSignal(false);
  const [highlighted, setHighlighted] = createSignal(-1);

  const selectedValues = createMemo(() => known.value ?? internalSelected());
  const selectedSet = createMemo(() => new Set(selectedValues()));
  const shownOptions = createMemo(() => {
    const shown = [...options()];
    selectedValues().forEach((v) => {
      if (!byValue().has(v)) shown.push({ value: v, label: v });
    });
    return known.hidePickedOptions ? shown.filter((o) => !selectedSet().has(o.value)) : shown;
  });

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

  const toggle = (v: string) => {
    if (known.disabled) return;
    const next = selectedSet().has(v) ? selectedValues().filter((x) => x !== v) : [...selectedValues(), v];
    const capped = known.maxValues !== undefined && next.length > known.maxValues ? next.slice(0, known.maxValues) : next;
    if (known.value === undefined) setInternalSelected(capped);
    known.onChange?.(capped);
  };

  createEffect(() => {
    if (!open()) return undefined;
    const root = rootEl;
    const handleOutside = (e: MouseEvent) => {
      if (open() && root && !root.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  });

  const handleInputChange = (e: Event) => {
    const next = (e.currentTarget as HTMLInputElement).value;
    setQuery(next);
    setOpen(true);
    known.onSearchChange?.(next, "input");
  };

  const handleClearSearch = () => {
    if (query() === "") return;
    setQuery("");
    known.onSearchChange?.("", "clear");
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      handleClearSearch();
      setOpen(false);
      return;
    }
    if (!open() && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (!open()) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((p) => Math.min(p + 1, Math.max(shownOptions().length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((p) => Math.max(p - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = shownOptions()[highlighted()];
      if (option && !option.disabled) toggle(option.value);
    }
  };

  const tagClass = "inline-flex items-center gap-1.5 border rounded-fin px-2 py-0.5 text-xs text-fin-text border-fin-border bg-fin-surface-alt";

  return (
    <div ref={(el) => (rootEl = el)} className={rootClass} data-testid={known["data-testid"]} style={rootStyle}>
      {known.label && (
        <label id={labelId} htmlFor={inputId} className={labelClass}>
          {known.label}
          {known.required && <span className="text-fin-negative"> *</span>}
        </label>
      )}
      <div className="relative w-full">
        {!known.hideTags && selectedValues().length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            <For each={selectedValues()}>{(v) => (
              <span className={tagClass}>
                {byValue().get(v)?.label ?? v}
                {known.clearable && !known.disabled && (
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
            )}</For>
          </div>
        )}
        <div className="inline-flex w-full items-center gap-2">
          {known.leftSection && <span className="shrink-0 text-fin-text-muted text-xs">{known.leftSection}</span>}
          <input
            id={inputId}
            role="combobox"
            aria-expanded={open()}
            aria-haspopup="listbox"
            aria-multiselectable="true"
            value={known.searchValue ?? query()}
            onInput={handleInputChange}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            disabled={known.disabled}
            required={known.required}
            placeholder={known.placeholder}
            className={controlClasses(known.size, known.disabled, isError)}
          />
          {known.rightSection && <span className="shrink-0">{known.rightSection}</span>}
        </div>
        <Show when={open()}>
          <ul role="listbox" className="absolute z-50 left-0 right-0 mt-1 border border-fin-border rounded-fin bg-fin-surface text-fin-text max-h-60 overflow-y-auto outline-none">
            {shownOptions().length === 0 ? (
              <li role="option" aria-disabled className="px-3 py-2 text-xs text-fin-text-muted">
                {known.nothingFoundMessage ?? "No options"}
              </li>
            ) : (
              <For each={shownOptions()}>{(opt) => (
                <li role="option" aria-selected={selectedSet().has(opt.value)} aria-disabled={opt.disabled || known.disabled}>
                  <label className="flex items-center gap-2 cursor-pointer select-none w-full px-3 py-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed">
                    <input
                      type="checkbox"
                      checked={selectedSet().has(opt.value)}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggle(opt.value);
                      }}
                      disabled={opt.disabled || known.disabled}
                      className="shrink-0 text-fin-primary"
                    />
                    {opt.label}
                  </label>
                </li>
              )}</For>
            )}
          </ul>
        </Show>
      </div>
      {helperText && <p className={helperTextClass}>{helperText}</p>}
    </div>
  );
}

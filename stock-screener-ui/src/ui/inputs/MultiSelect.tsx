import { createMemo, createSignal, createUniqueId, createEffect, For, Show, splitProps } from "solid-js";
import { cn } from "../cn";
import * as palette from "../palette";
import type { UIMultiSelectProps } from "../types";

type Option = { value: string; label: string; disabled?: boolean };

function normalizeOptions(data: UIMultiSelectProps["data"]): Option[] {
  if (!data) return [];
  return data.map((item) =>
    typeof item === "string" ? { value: item, label: item } : { value: item.value, label: item.label, disabled: item.disabled },
  );
}

/** Height map shared with the rest of the kit: xs 24 / sm 30 / md 34. */
function fieldMinHeight(size?: UIMultiSelectProps["size"]): string {
  if (size === "xs") return "24px";
  if (size === "sm") return "30px";
  return "34px";
}

function fieldPadding(size?: UIMultiSelectProps["size"]): string {
  if (size === "xs") return "pl-1.5 pr-11 text-[11px]";
  if (size === "sm") return "pl-2 pr-11 text-xs";
  return "pl-2 pr-11 text-sm";
}

function labelClasses(size?: UIMultiSelectProps["size"]): string {
  return cn("font-medium text-fin-text", size === "xs" || size === "sm" ? "text-xs" : "text-sm");
}

function helperTextClasses(error?: boolean): string {
  return cn("text-xs leading-none", error ? "text-fin-negative" : "text-fin-text-muted");
}

/** Tag geometry: 18px tall, 4px radius, 11px type, PRIMARY at 14%. */
const TAG_BOX = {
  "height": "18px",
  "border-radius": "4px",
  "background-color": palette.alpha(palette.PRIMARY, 0.14),
  "color": palette.TEXT,
  "font-size": "11px",
} as const;

/** Two tag rows (18px each + 4px gap) is the growth ceiling before folding to `+N`. */
const TAG_ROW_H = 18;
const TAG_ROW_GAP = 4;
const TAG_ROWS_MAX = 2;

/**
 * How many trailing tags to hide behind a `+N` chip. `widths` are the tag widths
 * measured on an unwrapped row, `boxWidth` is the usable field width. Wrapping is
 * greedy and a tag can never straddle a row, so a linear "two rows worth of
 * pixels" budget overcounts badly on narrow fields (three 57px tags in a 111px
 * box look like they fit 222px of budget, but only one fits per row).
 */
export function tagFoldCount(widths: number[], boxWidth: number, gap = TAG_ROW_GAP, maxRows = TAG_ROWS_MAX): number {
  if (widths.length === 0 || boxWidth <= 0) return 0;
  const chipWidth = 26;
  const rowsFor = (count: number): number => {
    let rows = 1;
    let used = 0;
    for (let i = 0; i < count; i++) {
      const next = used === 0 ? widths[i] : used + gap + widths[i];
      if (next > boxWidth && used > 0) {
        rows++;
        used = widths[i];
      } else {
        used = next;
      }
    }
    if (count < widths.length) {
      const next = used === 0 ? chipWidth : used + gap + chipWidth;
      if (next > boxWidth && used > 0) rows++;
    }
    return rows;
  };
  for (let keep = widths.length; keep >= 0; keep--) {
    if (rowsFor(keep) <= maxRows) return widths.length - keep;
  }
  return widths.length;
}

/**
 * A plain input has no chevron. That single glyph is what makes a picker read as
 * a picker even when colour is unavailable, so it is shared by Select/MultiSelect.
 */
function Chevron(props: { rotated?: boolean }) {
  return (
    <svg
      data-part="chevron"
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      className={cn(
        "pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 transition-transform duration-150",
        props.rotated ? "rotate-180" : "",
      )}
      style={{ "color": palette.TEXT_MUTED }}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
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
    "aria-label",
  ]);

  const inputId = known.id ?? createUniqueId();
  const labelId = createMemo(() => (known.label ? `${inputId}-multiselect-label` : undefined));
  const explicitWidth = createMemo(() =>
    known.w != null ? (typeof known.w === "number" ? `${known.w}px` : known.w) : undefined,
  );
  const explicitHeight = createMemo(() =>
    known.h != null ? (typeof known.h === "number" ? `${known.h}px` : known.h) : undefined,
  );
  const options = createMemo(() => normalizeOptions(known.data));
  const byValue = createMemo(() => new Map(options().map((o) => [o.value, o])));
  const isError = createMemo(() => Boolean(known.error));
  let rootEl: HTMLDivElement | undefined;
  const helperText = createMemo(() =>
    isError()
      ? typeof known.error === "string"
        ? known.error
        : String(known.error ?? "")
      : (known.description as string | undefined),
  );

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

  const rootClass = createMemo(() =>
    cn(
      "flex flex-col gap-2 text-sm leading-none",
      explicitWidth() == null ? "w-full" : undefined,
      known.className,
    ),
  );
  const rootStyle = createMemo(() => ({
    ...known.style,
    ...(explicitWidth() != null ? { width: explicitWidth()! } : {}),
    ...(explicitHeight() != null ? { height: explicitHeight()! } : {}),
  }));
  const labelClass = createMemo(() => labelClasses(known.size));
  const helperTextClass = createMemo(() => helperTextClasses(isError()));

  const toggle = (v: string) => {
    if (known.disabled) return;
    const next = selectedSet().has(v) ? selectedValues().filter((x) => x !== v) : [...selectedValues(), v];
    const capped = known.maxValues !== undefined && next.length > known.maxValues ? next.slice(0, known.maxValues) : next;
    if (known.value === undefined) setInternalSelected(capped);
    known.onChange?.(capped);
  };

  /* --- tag overflow: measure the row, fold the tail into a `+N` chip --------- */
  let tagsEl: HTMLDivElement | undefined;
  let fieldEl: HTMLDivElement | undefined;
  const [folded, setFolded] = createSignal(0);
  const visibleValues = createMemo(() => {
    const all = selectedValues();
    const cut = folded();
    return cut <= 0 ? all : all.slice(0, Math.max(all.length - cut, 0));
  });
  const foldedCount = createMemo(() => selectedValues().length - visibleValues().length);

  const measureTags = () => {
    const box = tagsEl;
    if (!box) return;
    const tags = [...box.querySelectorAll<HTMLElement>('[data-part="multiselect-tag"]')];
    if (tags.length === 0) { setFolded(0); return; }
    const widths = tags.map((t) => t.getBoundingClientRect().width);
    // happy-dom / pre-layout: no box model to measure against, keep every tag.
    if (!box.clientWidth || widths.some((w) => w <= 0)) { setFolded(0); return; }
    setFolded(tagFoldCount(widths, box.clientWidth));
  };

  /** Re-measure from a full row, then fold — folding before measuring loops. */
  const scheduleMeasure = () => {
    setFolded(0);
    queueMicrotask(measureTags);
  };

  // A microtask can land before the browser has laid the tags out, so the first
  // measurement sees zero widths and folds nothing (tags then clip). The field's
  // own resize signal is the reliable "layout is done" moment.
  createEffect(() => {
    const el = fieldEl;
    if (!el) return undefined;
    const observer = new ResizeObserver(() => measureTags());
    observer.observe(el);
    return () => observer.disconnect();
  });

  createEffect(() => {
    selectedValues();
    if (known.hideTags) return;
    scheduleMeasure();
  });

  createEffect(() => {
    if (!open()) return undefined;
    scheduleMeasure();
    return undefined;
  });

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

  const clearAll = (e: MouseEvent) => {
    e.stopPropagation();
    if (known.disabled) return;
    setQuery("");
    if (known.value === undefined) setInternalSelected([]);
    known.onChange?.([]);
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

  const hasSelection = createMemo(() => selectedValues().length > 0);

  const fieldStyle = createMemo(() => ({
    "min-height": explicitHeight() ?? fieldMinHeight(known.size),
    "border-radius": "6px",
    "border-color": isError() ? palette.NEGATIVE : open() ? palette.PRIMARY : palette.BORDER,
    "box-shadow": open() && !isError() ? `0 0 0 1px ${palette.PRIMARY}` : "none",
  }));

  const tagsRowStyle = {
    "max-height": `${TAG_ROW_H * TAG_ROWS_MAX + TAG_ROW_GAP}px`,
  } as const;

  return (
    <div ref={(el) => (rootEl = el)} className={rootClass()} data-testid={known["data-testid"]} style={rootStyle()}>
      {known.label && (
        <label id={labelId()} htmlFor={inputId} className={labelClass()}>
          {known.label}
          {known.required && <span className="text-fin-negative"> *</span>}
        </label>
      )}
      <div className="relative w-full">
        {/* One bordered field holds both the tags and the query input — a tag
            painted above the box reads as a label, not as a value. */}
        <div
          ref={(el) => (fieldEl = el)}
          data-part="multiselect-field"
          className={cn(
            "flex w-full min-w-0 items-center gap-1 border bg-fin-surface overflow-hidden",
            fieldPadding(known.size),
            known.disabled ? "opacity-50 cursor-not-allowed" : "",
          )}
          style={fieldStyle()}
        >
          <Show when={!known.hideTags && hasSelection()}>
            <div
              ref={(el) => (tagsEl = el)}
              className="flex min-w-0 flex-1 flex-wrap items-center gap-1 overflow-hidden"
              style={tagsRowStyle}
            >
              <For each={visibleValues()}>{(v) => (
                <span
                  data-part="multiselect-tag"
                  className="inline-flex min-w-0 max-w-full shrink items-center gap-1 px-1.5 leading-none"
                  style={TAG_BOX}
                >
                  <span className="truncate">{byValue().get(v)?.label ?? v}</span>
                  {known.clearable && !known.disabled && (
                    <button
                      type="button"
                      aria-label={`Remove ${v}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(v);
                      }}
                      className="shrink-0 text-fin-text-muted hover:text-fin-text"
                      style={{ "font-size": "11px", "line-height": "1" }}
                    >
                      &times;
                    </button>
                  )}
                </span>
              )}</For>
              <Show when={foldedCount() > 0}>
                <span
                  data-part="multiselect-overflow"
                  className="inline-flex shrink-0 items-center px-1.5 leading-none text-fin-text-muted"
                  style={{ ...TAG_BOX, "background-color": palette.SURFACE_ALT }}
                  title={selectedValues().slice(visibleValues().length).join(", ")}
                >
                  +{foldedCount()}
                </span>
              </Show>
            </div>
          </Show>
          <input
            id={inputId}
            role="combobox"
            aria-label={known["aria-label"]}
            aria-expanded={open()}
            aria-haspopup="listbox"
            aria-multiselectable="true"
            value={known.searchValue ?? query()}
            onInput={handleInputChange}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            disabled={known.disabled}
            required={known.required}
            placeholder={hasSelection() && !known.hideTags ? "" : known.placeholder}
            className={cn(
              "min-w-0 bg-transparent outline-none border-0 p-0 leading-none",
              "text-fin-text placeholder:text-fin-text-muted",
              // The tags own the field; the query box keeps just enough room to
              // type. A flex-1 input would split the width 50/50 and force the
              // tags to clip long before the field is actually full.
              hasSelection() && !known.hideTags ? "shrink-0 grow-0 w-[7ch]" : "flex-1",
            )}
          />
          {known.leftSection && <span className="shrink-0 text-fin-text-muted text-xs">{known.leftSection}</span>}
          {known.rightSection && <span className="shrink-0">{known.rightSection}</span>}
        </div>
        <Show when={hasSelection() && !known.disabled}>
          <button
            type="button"
            aria-label="Clear selection"
            onClick={clearAll}
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute right-7 top-1/2 -translate-y-1/2 shrink-0 leading-none text-fin-text-muted hover:text-fin-text"
          >
            &times;
          </button>
        </Show>
        <Chevron rotated={open()} />
        <Show when={open()}>
          <ul role="listbox" className="absolute z-50 left-0 right-0 mt-1 border border-fin-border rounded-[6px] bg-fin-surface text-fin-text max-h-60 overflow-y-auto outline-none">
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
      {helperText() && <p className={helperTextClass()}>{helperText()}</p>}
    </div>
  );
}

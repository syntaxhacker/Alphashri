import { For, Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup, splitProps, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { cn } from "../cn";
import type { UISelectProps } from "../types";

/** Gap between the field and the listbox, and the minimum viewport edge inset. */
const MENU_GAP = 4;
const MENU_PAD = 8;
/** `max-h-48` in px — the height the menu is allowed to grow to. */
const MENU_MAX_HEIGHT = 192;

/**
 * Portalled menus live in `<body>`, so a component whose owner never disposes
 * would leave its list floating over every later screen. A menu cannot outlive
 * its trigger: drop those before opening another.
 */
const liveMenus = new Set<{ trigger: HTMLElement; host: HTMLElement }>();

function pruneDetachedMenus() {
  for (const menu of liveMenus) {
    if (menu.trigger.isConnected) continue;
    menu.host.remove();
    liveMenus.delete(menu);
  }
}

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

    // In Solid, `props.children` evaluates to real DOM nodes: a <select> built
    // from <option> children hands back HTMLOptionElements, not React-style
    // {type, props} vnodes. Reading only the vnode shape found nothing, so every
    // children-driven select rendered "No options".
    if (typeof Element !== "undefined" && n instanceof Element) {
      if (n.tagName === "OPTION") {
        const opt = n as HTMLOptionElement;
        out.push({ value: opt.value, label: opt.textContent ?? "", disabled: opt.disabled });
        return;
      }
      n.childNodes.forEach(walk);
      return;
    }

    const el = n as { props?: { value?: unknown; disabled?: boolean; children?: unknown } };
    if (el.props && el.props.value !== undefined) {
      out.push({ value: String(el.props.value), label: textOf(el.props.children), disabled: Boolean(el.props.disabled) });
    }
    if (el.props?.children) walk(el.props.children);
  };
  walk(node);
  return out;
}

/**
 * Dropdown affordance shared by every select-like control: a chevron on the
 * right edge. This is the only cue that survives a monochrome/high-contrast
 * rendering, so it must never be replaced by colour alone.
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
      style={{ "color": "var(--color-fin-text-muted)" }}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Height map shared with the rest of the kit: xs 24 / sm 30 / md 34. */
function fieldHeight(size?: UISelectProps["size"]): string {
  if (size === "xs") return "24px";
  if (size === "sm") return "30px";
  return "34px";
}

function fieldPadding(size?: UISelectProps["size"]): string {
  if (size === "xs") return "pl-2 pr-7 text-[11px]";
  if (size === "sm") return "pl-2 pr-7 text-xs";
  return "pl-3 pr-7 text-sm";
}

/** The box is deliberately not a TextInput box: 6px radius, fixed height, chevron gutter. */
function fieldStyle(opts: { size?: UISelectProps["size"]; tone: "idle" | "active" | "error"; height?: string }): Record<string, string> {
  return {
    "height": opts.height ?? fieldHeight(opts.size),
    "border-radius": "6px",
    "border-color": opts.tone === "error" ? "var(--color-fin-negative)" : opts.tone === "active" ? "var(--color-fin-primary)" : "var(--color-fin-border)",
    "box-shadow": opts.tone === "active" ? "0 0 0 1px var(--color-fin-primary)" : "none",
  };
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
    "aria-label",
  ]);

  const inputId = known.id ?? createUniqueId();
  const labelId = createMemo(() => (known.label ? `${inputId}-label` : undefined));
  const explicitWidth = createMemo(() =>
    known.w != null ? (typeof known.w === "number" ? `${known.w}px` : known.w) : undefined,
  );
  const explicitHeight = createMemo(() =>
    known.h != null ? (typeof known.h === "number" ? `${known.h}px` : known.h) : undefined,
  );
  const options = createMemo(() => (known.data && known.data.length > 0 ? normalizeOptions(known.data) : optionsFromChildren(known.children)));
  const isError = createMemo(() => Boolean(known.error));
  let rootEl: HTMLDivElement | undefined;
  const isControlled = createMemo(
    () => known.value !== undefined || (known.onChange !== undefined && known.defaultValue === undefined),
  );
  const helperText = createMemo(() =>
    isError()
      ? typeof known.error === "string"
        ? known.error
        : String(known.error ?? "")
      : (known.description as string | undefined),
  );

  const rootClass = createMemo(() =>
    cn(
      "flex flex-col gap-1.5 text-sm leading-none",
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

  const [focused, setFocused] = createSignal(false);

  /** A closed native <select> has no "open" event; focus is the closest stable signal. */
  const tone = createMemo(() => (isError() ? "error" : focused() ? "active" : "idle") as "idle" | "active" | "error");
  const hasValue = createMemo(() => (known.value ?? known.defaultValue) != null && (known.value ?? known.defaultValue) !== "");

  const handleChange = (e: Event) => {
    const target = e.currentTarget as HTMLSelectElement;
    known.onChange?.(target.value === "" ? null : target.value);
  };

  const handleClear = (e: MouseEvent) => {
    e.stopPropagation();
    known.onChange?.(null);
  };

  const showClear = createMemo(() => known.clearable && (known.value ?? known.defaultValue) != null && !known.disabled);

  const adornments = (
    <div className="inline-flex w-full items-center gap-2">
      {known.leftSection && <span className="shrink-0 text-fin-text-muted text-xs">{known.leftSection}</span>}
      <div className="relative min-w-0 flex-1">
        <select
          id={inputId}
          name={known.name as string | undefined}
          value={isControlled() ? String(known.value ?? "") : known.defaultValue != null ? String(known.defaultValue) : undefined}
          onInput={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={known.disabled}
          required={known.required}
          aria-label={known["aria-label"]}
          className={cn(
            "appearance-none flex w-full min-w-0 border bg-fin-surface leading-none outline-none py-0",
            fieldPadding(known.size),
            known.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
          )}
          style={{
            ...fieldStyle({ size: known.size, tone: tone() }),
            "color": hasValue() ? "var(--color-fin-text)" : "var(--color-fin-text-muted)",
          }}
        >
          {known.placeholder && <option value="" disabled>{known.placeholder}</option>}
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
        <Chevron rotated={focused()} />
      </div>
      {showClear() && (
        <button type="button" aria-label="clear" onClick={handleClear} onMouseDown={(e) => e.stopPropagation()} className="shrink-0 p-1 text-fin-text-muted hover:bg-fin-surface-alt rounded-fin">
          &times;
        </button>
      )}
      {known.rightSection && <span className="shrink-0">{known.rightSection}</span>}
    </div>
  );

  return (
    <div ref={(el) => (rootEl = el)} className={rootClass()} data-testid={known["data-testid"]} style={rootStyle()}>
      {known.label && (
        <label id={labelId()} htmlFor={inputId} className={labelClass()}>
          {known.label}
          {known.required && <span className="text-fin-negative"> *</span>}
        </label>
      )}
      <Show
        when={known.searchable}
        fallback={adornments}
      >
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
          labelId={labelId()}
          isError={isError()}
          aria-label={known["aria-label"]}
          leftSection={known.leftSection}
          rightSection={known.rightSection}
          withinPortal={known.withinPortal}
        />
      </Show>
      {helperText() && <p className={helperTextClass()}>{helperText()}</p>}
    </div>
  );
}

function SearchableSelect(props: {
  rootRef: () => HTMLDivElement | undefined;
  options: SelectOption[];
  value: string | null | undefined;
  onChange?: (value: string | null) => void;
  disabled?: boolean;
  size?: UISelectProps["size"];
  clearable?: boolean;
  placeholder?: string;
  nothingFoundMessage?: string;
  inputId: string;
  labelId: string | undefined;
  isError: boolean;
  leftSection?: JSX.Element;
  rightSection?: JSX.Element;
  withinPortal?: boolean;
  "aria-label"?: string;
}) {
  const [query, setQuery] = createSignal("");
  const [typing, setTyping] = createSignal(false);
  const [open, setOpen] = createSignal(false);
  const [highlighted, setHighlighted] = createSignal(-1);
  const listboxId = `${props.inputId}-listbox`;
  let listboxEl: HTMLUListElement | undefined;
  let fieldEl: HTMLDivElement | undefined;
  const portalMenu = createMemo(() => props.withinPortal !== false);

  const filtered = createMemo(() =>
    props.options.filter(
      (o) => o.label.toLowerCase().includes(query().toLowerCase()) || o.value.toLowerCase().includes(query().toLowerCase()),
    ),
  );
  const selectedLabel = createMemo(() => props.options.find((o) => o.value === props.value)?.label);
  // A committed value outlives the query, so the label has to lose the input to
  // the query while the user is typing — otherwise every keystroke is written to
  // `query` and immediately painted over by the label.
  const displayValue = createMemo(() => (typing() ? query() : (selectedLabel() ?? "")));

  createEffect(() => {
    if (!open()) return undefined;
    const root = props.rootRef();
    // The listbox is portalled, so `root.contains` is false for its own
    // children: a mousedown on an option counted as "outside" and unmounted
    // the list before the click could commit the value.
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (open() && root && !root.contains(target) && !listboxEl?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  });

  /**
   * The listbox is portalled and `fixed`, positioned from the field's rect. An
   * absolute child is clipped by any ancestor with `overflow` — the market
   * toolbar is `overflow-hidden`, so the universe list was cut off at 30px.
   */
  const [menuPos, setMenuPos] = createSignal<{ top: number; left: number; width: number | undefined } | null>(null);

  const placeMenu = () => {
    const el = fieldEl ?? props.rootRef();
    if (!el) return;
    const r = el.getBoundingClientRect();
    const maxH = MENU_MAX_HEIGHT;
    const menuH = listboxEl?.getBoundingClientRect().height || maxH;
    // A hidden/zero-width field (display:none ancestor, pre-layout) yields an
    // all-zero rect; a `width: 0px` menu would then be invisible rather than
    // merely misplaced.
    const width = r.width > 0 ? Math.min(r.width, Math.max(0, window.innerWidth - MENU_PAD * 2)) : undefined;
    const spaceBelow = window.innerHeight - r.bottom - MENU_PAD;
    const spaceAbove = r.top - MENU_PAD;
    const openUp = spaceBelow < Math.min(menuH, maxH) + MENU_GAP && spaceAbove > spaceBelow;
    setMenuPos({
      top: openUp
        ? Math.max(MENU_PAD, r.top - Math.min(menuH, maxH, spaceAbove) - MENU_GAP)
        : r.bottom + MENU_GAP,
      left: Math.max(
        MENU_PAD,
        Math.min(r.left, window.innerWidth - (width ?? 0) - MENU_PAD),
      ),
      width,
    });
  };

  createEffect(() => {
    if (!open() || !portalMenu()) {
      setMenuPos(null);
      return;
    }
    // Render hidden first, then measure (visibility:hidden still lays out).
    queueMicrotask(placeMenu);
  });

  createEffect(() => {
    if (!open() || !portalMenu()) return;
    pruneDetachedMenus();
    // A scroll inside the menu itself must not reposition it — only an ancestor
    // scroller or the window moving the field does that.
    const onMove = (e: Event) => {
      if (listboxEl && e.target instanceof Node && listboxEl.contains(e.target)) return;
      placeMenu();
    };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    onCleanup(() => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    });
  });

  const handleSelect = (v: string) => {
    setOpen(false);
    setTyping(false);
    const found = props.options.find((o) => o.value === v);
    setQuery(found ? found.label : v);
    props.onChange?.(v);
  };

  const handleClear = (e: MouseEvent) => {
    e.stopPropagation();
    setTyping(false);
    setQuery("");
    setOpen(false);
    props.onChange?.(null);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      setTyping(false);
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

  const tone = createMemo(() => (props.isError ? "error" : open() ? "active" : "idle") as "idle" | "active" | "error");

  const trackMenu = (host: HTMLElement) => {
    const trigger = props.rootRef();
    if (!trigger) return;
    const menu = { trigger, host };
    liveMenus.add(menu);
    onCleanup(() => liveMenus.delete(menu));
  };

  const Listbox = () => (
    <ul
      ref={(el) => (listboxEl = el)}
      id={listboxId}
      role="listbox"
      data-part="select-listbox"
      className={cn(
        "border border-fin-border rounded-[6px] bg-fin-surface text-fin-text max-h-48 overflow-y-auto outline-none",
        portalMenu() ? "fixed z-[1300] shadow-md" : "absolute z-50 left-0 right-0 mt-1",
      )}
      style={
        portalMenu()
          ? {
              top: `${menuPos()?.top ?? 0}px`,
              left: `${menuPos()?.left ?? 0}px`,
              width: menuPos()?.width != null ? `${menuPos()!.width}px` : undefined,
              visibility: menuPos() ? "visible" : "hidden",
            }
          : undefined
      }
    >
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
              highlighted() === i() ? "bg-fin-surface-alt" : "",
              opt.disabled ? "text-fin-text-muted opacity-50" : "",
            )}
          >
            {opt.label}
          </li>
        )}</For>
      )}
    </ul>
  );

  return (
    <div className="w-full" onMouseDown={(e) => e.stopPropagation()}>
      <div className="relative w-full">
        <div className="inline-flex w-full items-center gap-2">
          {props.leftSection && <span className="shrink-0 text-fin-text-muted text-xs">{props.leftSection}</span>}
          <div ref={(el) => (fieldEl = el)} className="relative min-w-0 flex-1">
            <input
              id={props.inputId}
              role="combobox"
              aria-label={props["aria-label"]}
              aria-expanded={open()}
              aria-haspopup="listbox"
              aria-controls={listboxId}
              aria-multiselectable="false"
              value={displayValue()}
              onInput={(e) => {
                setTyping(true);
                setQuery(e.currentTarget.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => {
                setTyping(false);
                setOpen(false);
              }}
              onKeyDown={handleKeyDown}
              disabled={props.disabled}
              placeholder={props.placeholder}
              className={cn(
                "flex w-full min-w-0 border bg-fin-surface leading-none outline-none py-0",
                fieldPadding(props.size),
                props.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
                "text-fin-text placeholder:text-fin-text-muted",
              )}
              style={fieldStyle({ size: props.size, tone: tone() })}
            />
            <Chevron rotated={open()} />
          </div>
          {props.clearable && displayValue() && !props.disabled && (
            <button type="button" aria-label="clear" onClick={handleClear} onMouseDown={(e) => e.stopPropagation()} className="shrink-0 p-1 text-fin-text-muted hover:bg-fin-surface-alt rounded-fin">
              &times;
            </button>
          )}
          {props.rightSection && <span className="shrink-0">{props.rightSection}</span>}
        </div>
        <Show when={open()}>
          <Show when={portalMenu()} fallback={<Listbox />}>
            <Portal ref={trackMenu}>
              <Listbox />
            </Portal>
          </Show>
        </Show>
      </div>
    </div>
  );
}

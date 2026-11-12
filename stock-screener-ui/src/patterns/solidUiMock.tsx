/**
 * Test-only `@/ui` implementation for the Solid port.
 *
 * The real `@/ui` is mid-conversion and currently does not parse (a botched
 * kebab-case sweep left `"key"::` double-colons in ~40 modules). Rather than
 * depend on its state, tests in this scope render a lightweight stand-in with
 * the same export surface and props contract:
 *
 * - Real, dependency-free modules are re-exported unchanged (`cn`, `alpha`,
 *   `palette`, density hooks, color-scheme / media-query / disclosure hooks,
 *   notifications, `UIProvider`).
 * - Every interactive component is a plain pass-through with native semantics
 *   (button, input, select-like combobox) so `fireEvent`-driven tests behave
 *   like the real thing.
 *
 * Nothing here is imported by app code — tests only.
 */
import { createContext, createSignal, createEffect, splitProps, useContext, Show, For, type JSX } from "solid-js";
import { cn } from "@/ui/cn";
import { alpha } from "@/ui/alpha";
import * as palette from "@/ui/palette";
import { DensityProvider, useDensity, setDensity, getStoredDensity, DENSITY_TOKENS, DENSITY_STORAGE_KEY, TABLE_ROW_PY_VAR } from "@/ui/density";
import { useColorScheme, useTheme, useDebouncedValue, useMediaQuery, useTree, getTreeExpandedState, useDisclosure, rem } from "@/ui/hooks";
import { UIProvider, uiTheme } from "@/ui/theme";
import { showNotification, showSuccess, showError, Notifications } from "@/ui/notifications";

type DivProps = Record<string, any> & { children?: JSX.Element };

const FORWARDED = [
  "children",
  "class",
  "className",
  "classList",
  "style",
  "id",
  "data-testid",
  "role",
  "onClick",
  "onMouseEnter",
  "onMouseLeave",
  "onKeyDown",
  "onInput",
  "onChange",
  "onBlur",
  "onFocus",
  "onSubmit",
  "onKeyUp",
  "tabIndex",
  "href",
  "type",
  "title",
  "target",
  "rel",
  "aria-label",
  "aria-expanded",
  "aria-controls",
  "aria-pressed",
  "aria-hidden",
  "aria-busy",
  "htmlFor",
  "src",
  "alt",
  "viewBox",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "width",
  "height",
  "colspan",
  "rowspan",
] as const;

function attrs(props: DivProps) {
  const [local, rest] = splitProps(props, [...FORWARDED] as unknown as string[]);
  const extra = Object.fromEntries(
    Object.entries(rest).filter(([k]) => k.startsWith("data-") || k.startsWith("aria-")),
  );
  return { local, extra };
}

function shape(props: DivProps) {
  const { local, extra } = attrs(props);
  return {
    id: local.id,
    "data-testid": local["data-testid"],
    role: local.role,
    class: local.className ?? local.class,
    classList: local.classList,
    style: local.style,
    tabIndex: local.tabIndex,
    title: local.title,
    onClick: local.onClick,
    onMouseEnter: local.onMouseEnter,
    onMouseLeave: local.onMouseLeave,
    onKeyDown: local.onKeyDown,
    onInput: local.onInput,
    onChange: local.onChange,
    onBlur: local.onBlur,
    onFocus: local.onFocus,
    onSubmit: local.onSubmit,
    onKeyUp: local.onKeyUp,
    "aria-expanded": local["aria-expanded"],
    "aria-controls": local["aria-controls"],
    "aria-pressed": local["aria-pressed"],
    "aria-hidden": local["aria-hidden"],
    "aria-busy": local["aria-busy"],
    ...extra,
  };
}

function StubDiv(props: DivProps) {
  const { local, extra } = attrs(props);
  const s = shape(props);
  switch (props.component) {
    case "a":
      return (
        <a
          {...s}
          href={local.href}
          target={local.target}
          rel={local.rel}
          aria-label={local["aria-label"]}
          {...extra}
        >
          {local.children}
        </a>
      );
    case "button":
      return (
        <button {...s} type={local.type ?? "button"} aria-label={local["aria-label"]} {...extra}>
          {local.children}
        </button>
      );
    case "span":
      return <span {...s} aria-label={local["aria-label"]}>{local.children}</span>;
    case "img":
      return <img {...s} src={local.src} alt={local.alt} aria-label={local["aria-label"]} />;
    case "label":
      return (
        <label {...s} htmlFor={local.htmlFor}>
          {local.children}
        </label>
      );
    case "svg":
      return (
        <svg
          {...s}
          viewBox={local.viewBox}
          fill={local.fill}
          stroke={local.stroke}
          stroke-width={local["stroke-width"]}
          stroke-linecap={local["stroke-linecap"]}
          stroke-linejoin={local["stroke-linejoin"]}
          width={local.width}
          height={local.height}
        >
          {local.children}
        </svg>
      );
    case "table":
      return <table {...s}>{local.children}</table>;
    case "td":
      return <td {...s} colspan={local.colspan} rowspan={local.rowspan}>{local.children}</td>;
    case "th":
      return <th {...s} colspan={local.colspan} rowspan={local.rowspan}>{local.children}</th>;
    default:
      return <div {...s}>{local.children}</div>;
  }
}

function StubSection(props: DivProps) {
  const s = shape(props);
  return <section {...s}>{props.children}</section>;
}

function StubArticle(props: DivProps) {
  const s = shape(props);
  return <article {...s}>{props.children}</article>;
}

function StubText(props: DivProps & { size?: string; fw?: number | string; truncate?: boolean | string }) {
  const { local, extra } = attrs(props);
  return (
    <span {...shape(props)} classList={{ "truncate": Boolean(local.truncate), ...(local.classList ?? {}) }} {...extra}>
      {local.children}
    </span>
  );
}

function StubTitle(props: DivProps & { order?: number }) {
  const { local, extra } = attrs(props);
  const s = shape(props);
  const order = local.order ?? 4;
  if (order === 1) return <h1 {...s} {...extra}>{local.children}</h1>;
  if (order === 2) return <h2 {...s} {...extra}>{local.children}</h2>;
  if (order === 3) return <h3 {...s} {...extra}>{local.children}</h3>;
  if (order === 5) return <h5 {...s} {...extra}>{local.children}</h5>;
  if (order === 6) return <h6 {...s} {...extra}>{local.children}</h6>;
  return <h4 {...s} {...extra}>{local.children}</h4>;
}

function StubAnchor(props: DivProps & { href?: string }) {
  const { local, extra } = attrs(props);
  return (
    <a {...shape(props)} href={local.href} {...extra}>
      {local.children}
    </a>
  );
}

function StubList(props: DivProps & { ordered?: boolean }) {
  const s = shape(props);
  return localListTag(props, s);
}
const localListTag = (props: DivProps, s: Record<string, unknown>) =>
  (props as Record<string, any>)["type"] === "ordered" || (props as Record<string, any>).ordered
    ? <ol {...s}>{props.children}</ol>
    : <ul {...s}>{props.children}</ul>;

function StubListItem(props: DivProps) {
  const s = shape(props);
  return <li {...s}>{props.children}</li>;
}

function StubCode(props: DivProps) {
  const s = shape(props);
  return <code {...s}>{props.children}</code>;
}

function StubAvatar(props: DivProps) {
  const s = shape(props);
  return <span {...s}>{props.children}</span>;
}

function StubCloseButton(props: DivProps) {
  const s = shape(props);
  return (
    <button {...s} type="button" aria-label={props["aria-label"] ?? "close"}>
      ×
    </button>
  );
}

function StubButton(props: DivProps & { disabled?: boolean; loading?: boolean; type?: string; fullWidth?: boolean }) {
  const { local, extra } = attrs(props);
  return (
    <button
      {...shape(props)}
      type={local.type ?? "button"}
      disabled={Boolean(local.disabled) || Boolean(local.loading)}
      aria-busy={local.loading || undefined}
      onClick={local.onClick}
      {...extra}
    >
      {local.leftSection}
      {local.children}
      {local.rightSection}
    </button>
  );
}

function StubActionIcon(props: DivProps & { disabled?: boolean; loading?: boolean; variant?: string; color?: string; size?: string | number }) {
  const { local, extra } = attrs(props);
  return (
    <button
      {...shape(props)}
      type="button"
      disabled={Boolean(local.disabled) || Boolean(local.loading)}
      aria-busy={local.loading || undefined}
      aria-label={local["aria-label"]}
      onClick={local.onClick}
      {...extra}
    >
      {local.children}
    </button>
  );
}

function StubUnstyledButton(props: DivProps & { onClick?: (e: any) => void }) {
  const { local, extra } = attrs(props);
  return (
    <button {...shape(props)} type="button" onClick={local.onClick} {...extra}>
      {local.children}
    </button>
  );
}

function StubCopyButton(props: DivProps & { value: string }) {
  const [copied, setCopied] = createSignal(false);
  const copy = () => {
    try {
      void navigator.clipboard?.writeText?.(props.value);
    } catch {
      // clipboard unavailable — ignore
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return <>{props.children?.({ copied: copied(), copy })}</>;
}

const INPUT_CHROME = "border rounded-fin bg-fin-surface text-fin-text outline-none";

function StubTextInput(props: DivProps & {
  value?: string | number;
  defaultValue?: string | number;
  placeholder?: string;
  label?: JSX.Element;
  description?: JSX.Element;
  error?: JSX.Element | string;
  w?: number | string;
  h?: number | string;
  disabled?: boolean;
  leftSection?: JSX.Element;
  rightSection?: JSX.Element;
  onChange?: (value: string) => void;
  onBlur?: (e: any) => void;
  size?: string;
  type?: string;
}) {
  const [local, rest] = splitProps(props, [
    "value", "defaultValue", "placeholder", "label", "description", "error", "w", "h", "disabled",
    "leftSection", "rightSection", "onChange", "onBlur", "size", "type", "data-testid", "id", "name",
    "autoFocus", "autocomplete", "required", "className",
  ] as const);
  const id = local.id ?? `input-${Math.random().toString(36).slice(2, 8)}`;
  const isControlled = local.value !== undefined;
  return (
    <span class="inline-flex min-w-0 flex-col gap-1" style={{ width: typeof local.w === "number" ? `${local.w}px` : local.w }}>
      <Show when={local.label}>
        <label for={id} class="text-xs font-medium text-fin-text-muted">{local.label}</label>
      </Show>
      <span class="inline-flex items-center gap-1">
        {local.leftSection}
        <input
          id={id}
          type={local.type ?? "text"}
          class={cn(INPUT_CHROME, "px-2 py-1.5 text-xs", local.className)}
          placeholder={local.placeholder}
          disabled={Boolean(local.disabled)}
          required={local.required}
          name={local.name}
          data-testid={local["data-testid"]}
          value={isControlled ? String(local.value ?? "") : undefined}
          onInput={(e) => local.onChange?.(e.currentTarget.value)}
          onBlur={local.onBlur}
          {...(rest as Record<string, unknown>)}
        />
        {local.rightSection}
      </span>
      <Show when={local.description || local.error}>
        <span class="text-xs text-fin-text-muted">{local.error ?? local.description}</span>
      </Show>
    </span>
  );
}

const coerceNumber = (raw: string): number | string => {
  if (raw === "") return "";
  if (/[.]$|[eE][+-]?$/.test(raw)) return raw;
  const num = Number(raw);
  return Number.isNaN(num) ? raw : num;
};

function StubNumberInput(props: DivProps & {
  value?: number | string;
  placeholder?: string;
  label?: JSX.Element;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  prefix?: JSX.Element;
  suffix?: JSX.Element;
  onChange?: (value: number | string) => void;
  size?: string;
  w?: number | string;
  hideControls?: boolean;
}) {
  const [local, rest] = splitProps(props, [
    "value", "placeholder", "label", "min", "max", "step", "disabled", "prefix", "suffix",
    "onChange", "size", "w", "hideControls", "data-testid", "id", "name", "className",
  ] as const);
  const id = local.id ?? `num-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <span
      class="inline-flex min-w-0 flex-col gap-1"
      style={{ width: typeof local.w === "number" ? `${local.w}px` : local.w }}
      data-testid={local["data-testid"]}
    >
      <Show when={local.label}>
        <label for={id} class="text-xs font-medium text-fin-text-muted">{local.label}</label>
      </Show>
      <span class="inline-flex items-center gap-1">
        {local.prefix}
        <input
          id={id}
          type="number"
          role="spinbutton"
          min={local.min}
          max={local.max}
          step={local.step}
          class={cn(INPUT_CHROME, "px-2 py-1 text-xs", local.className)}
          placeholder={local.placeholder}
          disabled={Boolean(local.disabled)}
          name={local.name}
          data-testid={local["data-testid"] ? `${local["data-testid"]}-input` : undefined}
          value={local.value === undefined ? "" : String(local.value)}
          onInput={(e) => local.onChange?.(coerceNumber(e.currentTarget.value))}
          {...(rest as Record<string, unknown>)}
        />
        {local.suffix}
      </span>
    </span>
  );
}

function StubTextarea(props: DivProps & {
  value?: string;
  placeholder?: string;
  label?: JSX.Element;
  minRows?: number;
  disabled?: boolean;
  onChange?: (value: string) => void;
  size?: string;
  w?: number | string;
}) {
  const [local, rest] = splitProps(props, [
    "value", "placeholder", "label", "minRows", "disabled", "onChange", "size", "w",
    "data-testid", "id", "name", "autosize", "className",
  ] as const);
  const id = local.id ?? `ta-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <span class="inline-flex min-w-0 flex-col gap-1" style={{ width: "100%" }}>
      <Show when={local.label}>
        <label for={id} class="text-xs font-medium text-fin-text-muted">{local.label}</label>
      </Show>
      <textarea
        id={id}
        class={cn(INPUT_CHROME, "min-h-[60px] px-2 py-1.5 text-xs", local.className)}
        placeholder={local.placeholder}
        rows={local.minRows}
        disabled={Boolean(local.disabled)}
        name={local.name}
        data-testid={local["data-testid"]}
        onInput={(e) => local.onChange?.(e.currentTarget.value)}
        {...(rest as Record<string, unknown>)}
      >{local.value ?? ""}</textarea>
    </span>
  );
}

interface StubSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

function normalizeOptions(data: Array<string | { value: string; label?: string; disabled?: boolean }> = []): StubSelectOption[] {
  return data.map((item) =>
    typeof item === "string"
      ? { value: item, label: item }
      : { value: item.value, label: item.label ?? item.value, disabled: item.disabled },
  );
}

function StubSelect(props: DivProps & {
  data?: Array<string | { value: string; label?: string; disabled?: boolean }>;
  value?: string | null;
  onChange?: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: string;
  w?: number | string;
  nothingFoundMessage?: string;
  label?: JSX.Element;
  clearable?: boolean;
  searchable?: boolean;
}) {
  const [local, rest] = splitProps(props, [
    "data", "value", "onChange", "placeholder", "disabled", "size", "w", "nothingFoundMessage",
    "label", "clearable", "searchable", "data-testid", "id", "className", "onBlur",
  ] as const);
  const options = () => normalizeOptions(local.data);
  const id = local.id ?? `sel-${Math.random().toString(36).slice(2, 8)}`;
  let selectEl: HTMLSelectElement | undefined;
  createEffect(() => {
    if (selectEl) selectEl.value = String(local.value ?? "");
  });
  return (
    <span class="inline-flex min-w-0 flex-col gap-1" style={{ width: typeof local.w === "number" ? `${local.w}px` : local.w }} data-testid={local["data-testid"]}>
      <Show when={local.label}>
        <label for={id} class="text-xs font-medium text-fin-text-muted">{local.label}</label>
      </Show>
      <select
        ref={(el) => (selectEl = el)}
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        class={cn(INPUT_CHROME, "px-2 py-1.5 text-xs", local.className)}
        disabled={Boolean(local.disabled)}
        onChange={(e) => local.onChange?.(e.currentTarget.value === "" ? null : e.currentTarget.value)}
        onBlur={local.onBlur}
        {...(rest as Record<string, unknown>)}
      >
        <Show when={local.placeholder}>
          <option value="">{local.placeholder}</option>
        </Show>
        <For each={options()}>{(opt) => <option value={opt.value}>{opt.label}</option>}</For>
      </select>
    </span>
  );
}

function StubMultiSelect(props: DivProps & {
  data?: Array<string | { value: string; label?: string; disabled?: boolean }>;
  value?: string[];
  onChange?: (values: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: string;
  w?: number | string;
  nothingFoundMessage?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  clearable?: boolean;
  hidePickedOptions?: boolean;
  hideTags?: boolean;
  searchable?: boolean;
  label?: JSX.Element;
}) {
  const [local, rest] = splitProps(props, [
    "data", "value", "onChange", "placeholder", "disabled", "size", "w", "nothingFoundMessage",
    "searchValue", "onSearchChange", "clearable", "hidePickedOptions", "hideTags", "searchable",
    "label", "data-testid", "id", "className",
  ] as const);
  const [open, setOpen] = createSignal(false);
  const options = () => normalizeOptions(local.data);
  const selected = () => local.value ?? [];
  const toggle = (v: string) => {
    const current = selected();
    const next = current.includes(v) ? current.filter((item) => item !== v) : [...current, v];
    local.onChange?.(next);
  };
  return (
    <span class="relative inline-flex min-w-0 flex-col gap-1" style={{ width: typeof local.w === "number" ? `${local.w}px` : "100%" }}>
      <Show when={local.label}>
        <label class="text-xs font-medium text-fin-text-muted">{local.label}</label>
      </Show>
      <input
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open()}
        id={local.id}
        class={cn(INPUT_CHROME, "px-2 py-1 text-xs", local.className)}
        placeholder={local.placeholder}
        data-testid={local["data-testid"]}
        disabled={Boolean(local.disabled)}
        value={local.searchValue ?? ""}
        onInput={(e) => {
          setOpen(true);
          local.onSearchChange?.(e.currentTarget.value);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        {...(rest as Record<string, unknown>)}
      />
      <Show when={open()}>
        <ul role="listbox" aria-multiselectable="true" class="absolute z-50 mt-1 max-h-48 w-full overflow-auto border border-fin-border bg-fin-surface">
          <Show when={options().length === 0}>
            <li role="option" class="px-2 py-1 text-xs text-fin-text-muted" aria-disabled="true">
              {local.nothingFoundMessage ?? "No options"}
            </li>
          </Show>
          <For each={options()}>
            {(opt) => {
              const picked = () => selected().includes(opt.value);
              return (
                <li
                  role="option"
                  aria-selected={picked()}
                  class="flex cursor-pointer items-center gap-1 px-2 py-1 text-xs hover:bg-fin-surface-alt"
                  onClick={() => toggle(opt.value)}
                >
                  <input
                    type="checkbox"
                    readOnly
                    checked={picked()}
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(opt.value);
                    }}
                  />
                  {opt.label}
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
    </span>
  );
}

function StubSwitch(props: DivProps & { checked?: boolean; onChange?: (e: any) => void; label?: JSX.Element; disabled?: boolean }) {
  const [local, rest] = splitProps(props, ["checked", "onChange", "label", "disabled", "data-testid", "size"] as const);
  return (
    <label class="inline-flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        role="switch"
        class="accent-sky-500"
        checked={Boolean(local.checked)}
        disabled={Boolean(local.disabled)}
        data-testid={local["data-testid"]}
        onChange={local.onChange}
        {...(rest as Record<string, unknown>)}
      />
      <Show when={local.label}>
        <span class="text-xs text-fin-text">{local.label}</span>
      </Show>
    </label>
  );
}

function StubCheckbox(props: DivProps & { checked?: boolean; onChange?: (e: any) => void; onClick?: (e: any) => void; disabled?: boolean; label?: JSX.Element }) {
  const [local, rest] = splitProps(props, ["checked", "onChange", "onClick", "disabled", "label", "data-testid", "size"] as const);
  return (
    <label class="inline-flex cursor-pointer items-center gap-1">
      <input
        type="checkbox"
        class="accent-sky-500"
        checked={Boolean(local.checked)}
        disabled={Boolean(local.disabled)}
        data-testid={local["data-testid"]}
        onChange={local.onChange}
        onClick={local.onClick}
        {...(rest as Record<string, unknown>)}
      />
      <Show when={local.label}>
        <span class="text-xs text-fin-text">{local.label}</span>
      </Show>
    </label>
  );
}

function StubChip(props: DivProps & { checked?: boolean; defaultChecked?: boolean; onChange?: (next: boolean) => void; onClick?: (e: any) => void; disabled?: boolean }) {
  const [internal, setInternal] = createSignal(Boolean(props.defaultChecked));
  const isChecked = () => (props.checked !== undefined ? Boolean(props.checked) : internal());
  return (
    <button
      type="button"
      aria-pressed={isChecked()}
      data-testid={props["data-testid"]}
      disabled={Boolean(props.disabled)}
      class={props.className}
      style={props.style}
      onClick={(e) => {
        if (props.disabled) return;
        props.onClick?.(e);
        const next = !isChecked();
        if (props.checked === undefined) setInternal(next);
        props.onChange?.(next);
      }}
    >
      {props.children}
    </button>
  );
}

function StubSegmentedControl(props: DivProps & {
  data?: Array<{ value: string; label: string }>;
  value?: string;
  onChange?: (value: string) => void;
  size?: string;
  disabled?: boolean;
}) {
  const [local, rest] = splitProps(props, ["data", "value", "onChange", "size", "disabled", "data-testid"] as const);
  return (
    <span
      role="group"
      data-testid={local["data-testid"]}
      class="inline-flex rounded-fin border border-fin-border"
      {...(rest as Record<string, unknown>)}
    >
      <For each={local.data ?? []}>
        {(item) => (
          <button
            type="button"
            role="button"
            aria-pressed={local.value === item.value}
            data-testid={local["data-testid"] ? `${local["data-testid"]}-${item.value}` : undefined}
            disabled={Boolean(local.disabled)}
            class={cn(
              "px-2 py-1 text-xs",
              local.value === item.value ? "bg-fin-primary text-fin-bg" : "text-fin-text",
            )}
            onClick={() => local.onChange?.(item.value)}
          >
            {item.label}
          </button>
        )}
      </For>
    </span>
  );
}

function StubBadge(props: DivProps & {
  variant?: string;
  color?: string;
  size?: string;
  leftSection?: JSX.Element;
  rightSection?: JSX.Element;
}) {
  const s = shape(props);
  return (
    <span {...s} data-testid={props["data-testid"]}>
      {props.leftSection}
      {props.children}
      {props.rightSection}
    </span>
  );
}

function StubAlert(props: DivProps & { color?: string; variant?: string; title?: JSX.Element; icon?: JSX.Element }) {
  const s = shape(props);
  return (
    <div {...s} role="alert">
      {props.icon}
      {props.title ? <strong>{props.title}</strong> : null}
      {props.children}
    </div>
  );
}

function StubLoader(props: DivProps & { size?: string | number }) {
  const s = shape(props);
  return <span {...s} role="status" aria-label="loading" />;
}

function StubProgress(props: DivProps & { value?: number; max?: number }) {
  const value = () => Number(props.value ?? 0);
  const max = () => Number(props.max ?? 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max()}
      aria-valuenow={value()}
      data-testid={props["data-testid"]}
      class={props.className}
      style={props.style}
    >
      {props.children}
    </div>
  );
}

function StubRingProgress(props: DivProps & { value?: number; sections?: Array<{ value: number; color: string }>; size?: number }) {
  return (
    <svg
      role="progressbar"
      aria-valuenow={props.value ?? 50}
      aria-valuemin={0}
      aria-valuemax={100}
      data-testid={props["data-testid"]}
      style={props.style}
      width={props.size ?? 48}
      height={props.size ?? 48}
      viewBox="0 0 48 48"
    >
      <circle cx="24" cy="24" r="20" stroke="currentColor" fill="none" stroke-width="4" />
      {props.children}
    </svg>
  );
}

function StubSkeleton(props: DivProps & { h?: number | string; w?: number | string }) {
  const s = shape(props);
  return <div {...s} style={{ height: typeof props.h === "number" ? `${props.h}px` : props.h, width: typeof props.w === "number" ? `${props.w}px` : props.w }} />;
}

function StubTooltip(props: DivProps & { label?: JSX.Element; position?: string; multiline?: boolean; openDelay?: number; disabled?: boolean }) {
  const [open, setOpen] = createSignal(false);
  const labelText = () => (typeof props.label === "string" ? props.label : undefined);
  const s = shape(props);
  return (
    <span
      {...s}
      title={labelText()}
      onMouseOver={() => setOpen(true)}
      onMouseOut={() => setOpen(false)}
    >
      {props.children}
      <Show when={open() && props.label != null}>
        <span role="tooltip">{props.label}</span>
      </Show>
    </span>
  );
}

function StubDivider(props: DivProps & { orientation?: string }) {
  const s = shape(props);
  return <div {...s} aria-hidden="true" />;
}

function StubCollapse(props: DivProps & { in?: boolean }) {
  const s = shape(props);
  return (
    <div {...s} aria-hidden={!props.in || undefined} style={{ overflow: "hidden", height: props.in ? "auto" : 0, ...(props.style ?? {}) }}>
      {props.children}
    </div>
  );
}

function StubSimpleGrid(props: DivProps & { cols?: number }) {
  const s = shape(props);
  const cols = props.cols ?? 3;
  return <div {...s} style={{ display: "grid", "grid-template-columns": `repeat(${cols}, minmax(0, 1fr))`, gap: "8px", ...(props.style ?? {}) }}>{props.children}</div>;
}

function StubScrollArea(props: DivProps) {
  const s = shape(props);
  return <div {...s} style={{ overflow: "auto", ...(props.style ?? {}) }}>{props.children}</div>;
}

const TabsCtx = createContext<{ value: () => string; select: (v: string) => void }>({
  value: () => "table",
  select: () => {},
});

function Tabs(props: DivProps & { value?: string; defaultValue?: string; onChange?: (v: string | null) => void }) {
  const internal = createSignal<string | undefined>(props.defaultValue ?? props.value ?? "table");
  const isControlled = () => props.value !== undefined;
  const current = () => (isControlled() ? props.value! : internal[0]());
  const ctx = {
    value: current,
    select: (v: string) => {
      if (!isControlled()) internal[1](v);
      props.onChange?.(v);
    },
  };
  return (
    <TabsCtx.Provider value={ctx}>
      <div id={props.id} data-testid={props["data-testid"]} class={props.className} style={props.style}>
        {props.children}
      </div>
    </TabsCtx.Provider>
  );
}

function TabsList(props: DivProps) {
  return (
    <div role="tablist" data-testid={props["data-testid"]} class={props.className} style={props.style}>
      {props.children}
    </div>
  );
}

function Tab(props: DivProps & { value: string; leftSection?: JSX.Element }) {
  const ctx = useContext(TabsCtx);
  return (
    <button
      type="button"
      role="tab"
      data-testid={props["data-testid"]}
      class={props.className}
      onClick={() => ctx.select(props.value)}
    >
      {props.leftSection}
      {props.children}
    </button>
  );
}

function TabsPanel(props: DivProps & { value: string }) {
  const ctx = useContext(TabsCtx);
  return (
    <Show when={ctx.value() === props.value}>
      <div id={props.id} data-testid={props["data-testid"]} class={props.className} style={props.style}>
        {props.children}
      </div>
    </Show>
  );
}

const MenuCtx = createContext<{ open: () => boolean; toggle: () => void; close: () => void }>({
  open: () => false,
  toggle: () => {},
  close: () => {},
});

function Menu(props: DivProps & { opened?: boolean; defaultOpened?: boolean; onOpen?: () => void; onClose?: () => void; closeOnItemClick?: boolean; closeOnClickOutside?: boolean }) {
  const internal = createSignal<boolean>(props.defaultOpened ?? props.opened ?? false);
  const isControlled = () => props.opened !== undefined;
  const open = () => (isControlled() ? props.opened! : internal[0]());
  const ctx = {
    open,
    toggle: () => {
      const next = !open();
      if (!isControlled()) internal[1](next);
      if (next) props.onOpen?.();
      else props.onClose?.();
    },
    close: () => {
      if (!isControlled()) internal[1](false);
      props.onClose?.();
    },
  };
  return (
    <MenuCtx.Provider value={ctx}>
      <div data-testid={props["data-testid"]} class={props.className} style={props.style}>
        {props.children}
      </div>
    </MenuCtx.Provider>
  );
}

function MenuTarget(props: DivProps) {
  const ctx = useContext(MenuCtx);
  const { local, extra } = attrs(props);
  return (
    <div
      data-testid={local["data-testid"]}
      class={local.className}
      style={local.style}
      onClick={ctx.toggle}
      {...extra}
    >
      {local.children}
    </div>
  );
}

function MenuDropdown(props: DivProps) {
  const ctx = useContext(MenuCtx);
  return (
    <Show when={ctx.open()}>
      <div data-testid={props["data-testid"]} class={props.className} style={props.style} role="menu">
        {props.children}
      </div>
    </Show>
  );
}

function MenuItem(props: DivProps & { closeOnClick?: boolean }) {
  const ctx = useContext(MenuCtx);
  const { local, extra } = attrs(props);
  return (
    <div
      role="menuitem"
      data-testid={local["data-testid"]}
      class={local.className}
      style={local.style}
      onClick={() => {
        local.onClick?.();
        if (props.closeOnClick !== false) ctx.close();
      }}
      {...extra}
    >
      {local.children}
    </div>
  );
}

function Modal(props: DivProps & { opened?: boolean; title?: JSX.Element; onClose?: () => void }) {
  return (
    <Show when={props.opened}>
      <div
        id={props.id}
        data-testid={props["data-testid"]}
        role="dialog"
        aria-modal="true"
        class={props.className}
        style={props.style}
      >
        <div class="relative flex items-center justify-between border-b" style={{ width: "100%" }}>
          {props.title ? <div data-testid={props["data-testid"] ? `${props["data-testid"]}-title` : undefined}>{props.title}</div> : <div />}
          {props.onClose ? (
            <button
              type="button"
              aria-label="close"
              data-testid={props["data-testid"] ? `${props["data-testid"]}-close` : undefined}
              onClick={props.onClose}
            >
              ×
            </button>
          ) : null}
        </div>
        {props.children}
      </div>
    </Show>
  );
}

function Timeline(props: DivProps) {
  return (
    <ol data-testid={props["data-testid"]} class={props.className} style={props.style}>
      {props.children}
    </ol>
  );
}

function TimelineItem(props: DivProps & { bullet?: JSX.Element; title?: JSX.Element }) {
  return (
    <li data-testid={props["data-testid"]} class={props.className} style={props.style}>
      {props.bullet ? <div>{props.bullet}</div> : null}
      {props.title ? <div>{props.title}</div> : null}
      {props.children}
    </li>
  );
}

function ThemeIcon(props: DivProps) {
  return (
    <span data-testid={props["data-testid"]} class={props.className ?? props.class} style={props.style}>
      {props.children}
    </span>
  );
}

function Overlay(props: DivProps & { onClick?: (e: any) => void }) {
  const s = shape(props);
  return <div {...s} onClick={props.onClick}>{props.children}</div>;
}

function Popover(props: DivProps) {
  return <div {...shape(props)}>{props.children}</div>;
}

function PopoverTarget(props: DivProps) {
  return <div {...shape(props)}>{props.children}</div>;
}

function PopoverDropdown(props: DivProps) {
  return <div {...shape(props)}>{props.children}</div>;
}

function FloatingWindow(props: DivProps) {
  return <div {...shape(props)}>{props.children}</div>;
}

function NavLink(props: DivProps & { href?: string; onClick?: (e: any) => void }) {
  const s = shape(props);
  return <a {...s} href={props.href} onClick={props.onClick}>{props.children}</a>;
}

function AppShell(props: DivProps) {
  return <div {...shape(props)}>{props.children}</div>;
}

function AppShellHeader(props: DivProps) {
  return <header {...shape(props)}>{props.children}</header>;
}

function AppShellNavbar(props: DivProps) {
  return <nav {...shape(props)}>{props.children}</nav>;
}

function AppShellMain(props: DivProps) {
  return <main {...shape(props)}>{props.children}</main>;
}

function AppShellSection(props: DivProps) {
  return <section {...shape(props)}>{props.children}</section>;
}

function AvatarStub(props: DivProps) {
  return <span {...shape(props)}>{props.children}</span>;
}

function Accordion(props: DivProps) {
  return <div {...shape(props)}>{props.children}</div>;
}

function AccordionItem(props: DivProps) {
  return <div {...shape(props)}>{props.children}</div>;
}

function AccordionControl(props: DivProps & { onClick?: (e: any) => void }) {
  const s = shape(props);
  return <button {...s} type="button" onClick={props.onClick}>{props.children}</button>;
}

function AccordionPanel(props: DivProps) {
  return <div {...shape(props)}>{props.children}</div>;
}

function Tree(props: DivProps) {
  return <ul {...shape(props)}>{props.children}</ul>;
}

function DatePicker(props: DivProps & { value?: string }) {
  const s = shape(props);
  return <input {...s} type="date" value={props.value} />;
}

function Indicator(props: DivProps & { count?: number; disabled?: boolean; color?: string; position?: string; label?: JSX.Element; size?: number }) {
  return <span {...shape(props)}>{props.children}</span>;
}

function LoadingOverlay(props: DivProps & { visible?: boolean; zIndex?: number }) {
  return <Show when={props.visible}><div {...shape(props)}>{props.children}</div></Show>;
}

function PasswordInput(props: DivProps & { value?: string; onChange?: (value: string) => void; label?: JSX.Element }) {
  return <StubTextInput {...props} type="password" />;
}

/** Test-only `@/ui` surface. `extra` lets a test override single components. */
export function mockSolidUi(extra: Record<string, any> = {}): Record<string, any> {
  return {
    // dependency-free real modules
    cn,
    alpha,
    palette,
    UIProvider,
    uiTheme,
    DensityProvider,
    useDensity,
    setDensity,
    getStoredDensity,
    DENSITY_TOKENS,
    DENSITY_STORAGE_KEY,
    TABLE_ROW_PY_VAR,
    useColorScheme,
    useTheme,
    useDebouncedValue,
    useMediaQuery,
    useTree,
    getTreeExpandedState,
    useDisclosure,
    rem,
    showNotification,
    showSuccess,
    showError,
    Notifications,
    // components
    Box: StubDiv,
    Stack: StubDiv,
    Flex: StubDiv,
    Group: StubDiv,
    Center: StubDiv,
    Paper: StubSection,
    Card: StubArticle,
    SimpleGrid: StubSimpleGrid,
    Grid: StubSimpleGrid,
    GridCol: StubDiv,
    ScrollArea: StubScrollArea,
    Divider: StubDivider,
    Collapse: StubCollapse,
    ToolbarRow: StubDiv,
    Text: StubText,
    Title: StubTitle,
    Anchor: StubAnchor,
    Code: StubCode,
    List: StubList,
    ListItem: StubListItem,
    Avatar: StubAvatar,
    CloseButton: StubCloseButton,
    Button: StubButton,
    ActionIcon: StubActionIcon,
    UnstyledButton: StubUnstyledButton,
    CopyButton: StubCopyButton,
    TextInput: StubTextInput,
    NumberInput: StubNumberInput,
    Textarea: StubTextarea,
    Select: StubSelect,
    MultiSelect: StubMultiSelect,
    Switch: StubSwitch,
    Checkbox: StubCheckbox,
    Chip: StubChip,
    SegmentedControl: StubSegmentedControl,
    PasswordInput: StubTextInput,
    Badge: StubBadge,
    Alert: StubAlert,
    Loader: StubLoader,
    Progress: StubProgress,
    RingProgress: StubRingProgress,
    Skeleton: StubSkeleton,
    LoadingOverlay: StubDiv,
    Indicator: StubDiv,
    Tooltip: StubTooltip,
    Tabs,
    TabsList,
    Tab,
    TabsPanel,
    Menu,
    MenuTarget,
    MenuDropdown,
    MenuItem,
    Modal,
    Timeline,
    TimelineItem,
    ThemeIcon,
    Overlay: StubDiv,
    Popover,
    PopoverTarget,
    PopoverDropdown,
    FloatingWindow,
    NavLink,
    AppShell,
    AppShellHeader,
    AppShellNavbar,
    AppShellMain,
    AppShellSection,
    Accordion,
    AccordionItem,
    AccordionControl,
    AccordionPanel,
    Tree,
    DatePicker,
    ...extra,
  };
}

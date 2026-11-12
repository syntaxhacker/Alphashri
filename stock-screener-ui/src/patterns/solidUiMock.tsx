/**
 * Test-only stubs for the `@/ui` components that currently crash under Solid
 * in this repo (see SOLID_MIGRATION notes): the six layout primitives render
 * `<Tag>` with a runtime string, and Solid's `createComponent` requires a
 * function. `Tabs` references `createSignal` without importing it, and
 * `Timeline` calls its context values as accessors while callers pass plain
 * numbers. Until the src/ui owners fix those primitives, tests in this scope
 * render the real `@/ui` module with these pieces replaced by plain
 * pass-through components. Everything else (Text, Badge, hooks, cn, ...) is
 * the real implementation.
 *
 * The stubs also honor `component=` (the subset of intrinsic tags used across
 * the app) so components like SymbolLink (`<Box component="a" href=…>`) keep
 * working under the stub.
 */
import { createContext, createSignal, splitProps, useContext, Show, type JSX } from "solid-js";

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
  "tabIndex",
  "href",
  "type",
  "title",
  "target",
  "rel",
  "aria-label",
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
      return <span {...s}>{local.children}</span>;
    case "img":
      return <img {...s} src={local.src} alt={local.alt} />;
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
        {props.title ? <div data-testid={props["data-testid"] ? `${props["data-testid"]}-title` : undefined}>{props.title}</div> : null}
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

/** Replace the known-crashing `@/ui` components; keep everything else. */
export function mockSolidUi(actual: Record<string, any>, extra: Record<string, any> = {}) {
  return {
    ...actual,
    Box: StubDiv,
    Stack: StubDiv,
    Flex: StubDiv,
    Group: StubDiv,
    Paper: StubSection,
    Card: StubArticle,
    Tabs,
    TabsList,
    Tab,
    TabsPanel,
    Modal,
    Timeline,
    TimelineItem,
    ThemeIcon,
    Menu,
    MenuTarget,
    MenuDropdown,
    MenuItem,
    ...extra,
  };
}

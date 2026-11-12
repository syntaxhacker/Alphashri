import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  Show,
  useContext,
  type JSX,
} from "solid-js";
import { cn } from "@/ui";
import { Group } from "./primitives";
import { Text } from "@/ui";

/**
 * Local overlays matching the @/ui Modal / Popover / Tabs API surface used by
 * my scope. The @/ui versions crash at mount in the Solid build (missing
 * createSignal import in Menu/Tabs, an un-called tuple in Popover, a bare
 * `testId` reference in Modal), so my scope carries faithful minimal copies.
 */

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal(props: {
  opened: boolean;
  onClose: () => void;
  title?: JSX.Element;
  size?: "sm" | "md" | "lg" | number;
  children?: JSX.Element;
  "data-testid"?: string;
  closeOnEscape?: boolean;
  closeOnClickOutside?: boolean;
  withCloseButton?: boolean;
  className?: string;
  style?: JSX.CSSProperties;
}) {
  const close = () => props.onClose();
  const closeOnEscape = () => props.closeOnEscape ?? true;
  const closeOnClickOutside = () => props.closeOnClickOutside ?? true;

  createEffect(() => {
    if (!props.opened) return;
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closeOnEscape()) close();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onDocKey);
    onCleanup(() => {
      document.removeEventListener("keydown", onDocKey);
      document.body.style.overflow = previousOverflow;
    });
  });

  const maxWidth = () =>
    props.size === "sm" ? 420 : props.size === "lg" ? 760 : typeof props.size === "number" ? props.size : 560;

  return (
    <Show when={props.opened}>
      <div class="fixed inset-0 z-50 flex items-center justify-center" role="presentation">
        <button
          type="button"
          aria-label="Close modal"
          class="absolute inset-0 bg-black/60 cursor-default"
          onClick={() => closeOnClickOutside() && close()}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label={typeof props.title === "string" ? props.title : undefined}
          class="relative bg-neutral-900 border border-neutral-800 rounded-fin shadow-lg p-3 w-full mx-3"
          style={{ maxWidth: `${maxWidth()}px`, ...(props.style as Record<string, unknown> | undefined) }}
          data-testid={props["data-testid"]}
        >
          <Show when={props.title != null}>
            <Group justify="space-between" align="center" className="mb-2">
              <Text fw={700} size="sm">{props.title}</Text>
              <Show when={props.withCloseButton ?? true}>
                <button
                  type="button"
                  aria-label="Close"
                  data-testid={props["data-testid"] ? `${props["data-testid"]}-close` : undefined}
                  onClick={close}
                  class="text-neutral-400 hover:text-neutral-100 text-base leading-none px-1"
                >
                  ×
                </button>
              </Show>
            </Group>
          </Show>
          {props.children}
        </div>
      </div>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Popover
// ---------------------------------------------------------------------------

interface PopoverContextValue {
  open: () => boolean;
  setOpen: (open: boolean) => void;
  close: () => void;
  width: () => number | string | undefined;
  setTriggerRef: (el: HTMLElement | undefined) => void;
  setDropdownRef: (el: HTMLElement | undefined) => void;
  triggerRef: () => HTMLElement | undefined;
  dropdownRef: () => HTMLElement | undefined;
}

const PopoverContext = createContext<PopoverContextValue | null>(null);

function usePopoverContext() {
  const ctx = useContext(PopoverContext);
  if (!ctx) throw new Error("Popover compound components must be used within Popover");
  return ctx;
}

export function Popover(props: {
  opened?: boolean;
  onClose?: () => void;
  onChange?: (open: boolean) => void;
  width?: number | string;
  position?: string;
  shadow?: string;
  withArrow?: boolean;
  offset?: number;
  closeOnClickOutside?: boolean;
  className?: string;
  style?: JSX.CSSProperties;
  id?: string;
  "data-testid"?: string;
  children?: JSX.Element;
}) {
  const [uncontrolled, setUncontrolled] = createSignal(false);
  const [triggerRef, setTriggerRef] = createSignal<HTMLElement | undefined>(undefined);
  const [dropdownRef, setDropdownRef] = createSignal<HTMLElement | undefined>(undefined);

  const isControlled = () => props.opened !== undefined;
  const open = () => (isControlled() ? !!props.opened : uncontrolled());
  const setOpen = (o: boolean) => {
    if (!isControlled()) setUncontrolled(o);
    props.onChange?.(o);
  };
  const close = () => {
    setOpen(false);
    props.onClose?.();
  };

  createEffect(() => {
    if (!open()) return;
    if ((props.closeOnClickOutside ?? true) === false) return;
    const onDocPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      const trigger = triggerRef();
      const dropdown = dropdownRef();
      if (t && ((trigger && trigger.contains(t)) || (dropdown && dropdown.contains(t)))) return;
      close();
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    onCleanup(() => document.removeEventListener("pointerdown", onDocPointerDown, true));
  });

  const ctx: PopoverContextValue = {
    open,
    setOpen,
    close,
    width: () => props.width,
    setTriggerRef,
    setDropdownRef,
    triggerRef,
    dropdownRef,
  };

  return (
    <PopoverContext.Provider value={ctx}>
      <span
        id={props.id}
        class={cn("relative inline-flex", props.className)}
        style={props.style as Record<string, unknown> | undefined}
        data-testid={props["data-testid"]}
      >
        {props.children}
      </span>
    </PopoverContext.Provider>
  );
}

export function PopoverTarget(props: { children?: JSX.Element }) {
  const ctx = usePopoverContext();
  return (
    <span
      ref={(el) => ctx.setTriggerRef(el)}
      class="inline-flex"
      onClick={() => ctx.setOpen(!ctx.open())}
    >
      {props.children}
    </span>
  );
}

export function PopoverDropdown(props: {
  p?: string;
  className?: string;
  style?: JSX.CSSProperties;
  "data-testid"?: string;
  children?: JSX.Element;
}) {
  const ctx = usePopoverContext();
  return (
    <Show when={ctx.open()}>
      <span
        ref={(el) => ctx.setDropdownRef(el)}
        class={cn(
          "absolute z-50 top-full right-0 mt-1 rounded-fin border border-fin-border bg-fin-surface shadow-md",
          props.p === "xs" && "p-1",
          props.className,
        )}
        style={{ width: ctx.width() != null ? `${ctx.width()}px` : undefined, ...(props.style as Record<string, unknown> | undefined) }}
        data-testid={props["data-testid"]}
      >
        {props.children}
      </span>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const TabsContext = createContext<{
  value: () => string | null | undefined;
  onChange: (v: string) => void;
} | null>(null);

function useTabsContext() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("Tabs compound components must be used within Tabs");
  return ctx;
}

function TabsRoot(props: {
  value?: string | null;
  onChange?: (v: string | null) => void;
  variant?: string;
  className?: string;
  id?: string;
  "data-testid"?: string;
  children?: JSX.Element;
}) {
  const ctxValue = {
    value: () => props.value ?? null,
    onChange: (v: string) => props.onChange?.(v),
  };
  return (
    <TabsContext.Provider value={ctxValue}>
      <div id={props.id} class={cn(props.className)} data-testid={props["data-testid"]}>
        {props.children}
      </div>
    </TabsContext.Provider>
  );
}

function TabsList(props: { className?: string; children?: JSX.Element }) {
  return (
    <div role="tablist" class={cn("flex items-center gap-1 border-b border-fin-border", props.className)}>
      {props.children}
    </div>
  );
}

function Tab(props: {
  value: string;
  leftSection?: JSX.Element;
  rightSection?: JSX.Element;
  disabled?: boolean;
  className?: string;
  id?: string;
  "data-testid"?: string;
  children?: JSX.Element;
}) {
  const ctx = useTabsContext();
  const active = () => ctx.value() === props.value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active()}
      id={props.id}
      disabled={props.disabled}
      class={cn(
        "flex items-center gap-1 px-2 py-1 text-xs border-b-2 -mb-px transition-colors",
        active() ? "text-fin-primary border-fin-primary" : "text-fin-text-muted border-transparent hover:text-fin-text",
        props.className,
      )}
      data-testid={props["data-testid"]}
      onClick={() => ctx.onChange(props.value)}
    >
      {props.leftSection}
      {props.children}
      {props.rightSection}
    </button>
  );
}

export const Tabs = Object.assign(TabsRoot, { List: TabsList, Tab });

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

interface MenuContextValue {
  open: () => boolean;
  setOpen: (open: boolean) => void;
  close: () => void;
  triggerRef: () => HTMLElement | undefined;
  dropdownRef: () => HTMLElement | undefined;
  setTriggerRef: (el: HTMLElement | undefined) => void;
  setDropdownRef: (el: HTMLElement | undefined) => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

function useMenuContext() {
  const ctx = useContext(MenuContext);
  if (!ctx) throw new Error("Menu compound components must be used within Menu");
  return ctx;
}

function MenuRoot(props: {
  position?: string;
  width?: number | string;
  children?: JSX.Element;
  className?: string;
  id?: string;
  "data-testid"?: string;
}) {
  const [uncontrolled, setUncontrolled] = createSignal(false);
  const [triggerRef, setTriggerRef] = createSignal<HTMLElement | undefined>(undefined);
  const [dropdownRef, setDropdownRef] = createSignal<HTMLElement | undefined>(undefined);

  const open = () => uncontrolled();
  const setOpen = (o: boolean) => setUncontrolled(o);
  const close = () => setUncontrolled(false);

  createEffect(() => {
    if (!open()) return;
    const onDocPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      const trigger = triggerRef();
      const dropdown = dropdownRef();
      if (t && ((trigger && trigger.contains(t)) || (dropdown && dropdown.contains(t)))) return;
      close();
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    onCleanup(() => document.removeEventListener("pointerdown", onDocPointerDown, true));
  });

  const ctx: MenuContextValue = {
    open,
    setOpen,
    close,
    triggerRef,
    dropdownRef,
    setTriggerRef,
    setDropdownRef,
  };

  return (
    <MenuContext.Provider value={ctx}>
      <span id={props.id} class={cn("relative inline-flex", props.className)} data-testid={props["data-testid"]}>
        {props.children}
      </span>
    </MenuContext.Provider>
  );
}

function MenuTarget(props: { children?: JSX.Element }) {
  const ctx = useMenuContext();
  return (
    <span ref={(el) => ctx.setTriggerRef(el)} class="inline-flex" onClick={() => ctx.setOpen(!ctx.open())}>
      {props.children}
    </span>
  );
}

function MenuDropdown(props: {
  className?: string;
  style?: JSX.CSSProperties;
  "data-testid"?: string;
  children?: JSX.Element;
}) {
  const ctx = useMenuContext();
  return (
    <Show when={ctx.open()}>
      <span
        ref={(el) => ctx.setDropdownRef(el)}
        role="menu"
        class={cn(
          "absolute z-50 top-full right-0 mt-1 min-w-36 rounded-fin border border-fin-border bg-fin-surface shadow-md py-0.5",
          props.className,
        )}
        style={props.style as Record<string, unknown> | undefined}
        data-testid={props["data-testid"]}
      >
        {props.children}
      </span>
    </Show>
  );
}

function MenuItem(props: {
  onClick?: () => void;
  disabled?: boolean;
  leftSection?: JSX.Element;
  rightSection?: JSX.Element;
  color?: string;
  className?: string;
  "data-testid"?: string;
  children?: JSX.Element;
}) {
  const ctx = useMenuContext();
  const handleClick = () => {
    if (props.disabled) return;
    ctx.close();
    props.onClick?.();
  };
  return (
    <button
      type="button"
      role="menuitem"
      disabled={props.disabled}
      class={cn(
        "flex w-full items-center gap-2 px-2 py-1 text-xs text-left",
        props.color === "secondary" ? "text-fin-text-muted" : "text-fin-text",
        "hover:bg-fin-surface-alt disabled:opacity-50 disabled:cursor-not-allowed",
        props.className,
      )}
      data-testid={props["data-testid"]}
      onClick={handleClick}
    >
      {props.leftSection}
      {props.children}
      {props.rightSection}
    </button>
  );
}

function MenuDivider(props: { className?: string }) {
  return <span role="separator" class={cn("block h-px bg-fin-border my-0.5", props.className)} />;
}

export const Menu = Object.assign(MenuRoot, { Target: MenuTarget, Dropdown: MenuDropdown, Item: MenuItem, Divider: MenuDivider });

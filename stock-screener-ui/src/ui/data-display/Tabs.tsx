import { createContext, createMemo, createSignal, Show, splitProps, useContext } from "solid-js";
import { cn } from "../cn";
import type { UITabsProps, UITabProps, UITabsPanelProps } from "../types";

type TabsContextValue = {
  value: () => string | null | undefined;
  onChange: (v: string | null) => void;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("Tabs compound components must be used within Tabs");
  return ctx;
}

export function Tabs(props: UITabsProps) {
  const [known, rest] = splitProps(props, [
    "value",
    "defaultValue",
    "onChange",
    "orientation",
    "children",
    "className",
    "style",
    "id",
    "data-testid",
  ]);

  const isControlled = createMemo(() => known.value !== undefined);
  const internal = createSignal<string | null | undefined>(known.defaultValue ?? null);
  const [internalValue, setInternalValue] = internal;
  const activeValue = createMemo(() => (isControlled() ? known.value : internalValue()));

  const handleChange = (v: string | null) => {
    if (!isControlled()) setInternalValue(v);
    known.onChange?.(v);
  };

  const ctxValue: TabsContextValue = { value: activeValue, onChange: handleChange };

  const cls = cn(
    "ui-tabs-wrapper",
    "min-w-0",
    known.orientation === "vertical" ? "flex flex-row" : "flex flex-col",
    known.className,
  );

  return (
    <TabsContext.Provider value={ctxValue}>
      <div
        id={known.id}
        className={cls}
        style={known.style as Record<string, string | undefined>}
        data-testid={known["data-testid"]}
        {...(rest as Record<string, unknown>)}
      >
        {known.children}
      </div>
    </TabsContext.Provider>
  );
}

export function TabsList(props: UITabsProps) {
  const [known, rest] = splitProps(props, ["orientation", "children", "className", "style", "id", "data-testid"]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const list = e.currentTarget as HTMLElement;
    const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])'));
    const target = e.target as HTMLElement;
    const idx = tabs.indexOf(target);
    if (idx === -1 || tabs.length === 0) return;
    let next: HTMLElement;
    if (e.key === "ArrowLeft") next = tabs[(idx - 1 + tabs.length) % tabs.length];
    else if (e.key === "ArrowRight") next = tabs[(idx + 1) % tabs.length];
    else if (e.key === "Home") next = tabs[0];
    else next = tabs[tabs.length - 1];
    next.focus();
  };

  const cls = cn(
    "ui-tabs-list",
    known.orientation === "vertical" ? "flex flex-col" : "flex flex-row items-stretch",
    // Flat navigation strip: one rule under the whole row, active tab marked by
    // an accent underline landing on it. Pass `className="border-b-0"` (plus an
    // inline border-bottom-width:0) when a surrounding bar owns the rule.
    "gap-0 min-h-[30px] border-b border-fin-border",
    known.className,
  );

  return (
    <div
      id={known.id}
      role="tablist"
      aria-orientation={known.orientation}
      className={cls}
      style={known.style as Record<string, string | undefined>}
      data-testid={known["data-testid"]}
      onKeyDown={handleKeyDown}
      {...(rest as Record<string, unknown>)}
    >
      {known.children}
    </div>
  );
}

export function Tab(props: UITabProps) {
  const [known, rest] = splitProps(props, [
    "value",
    "icon",
    "leftSection",
    "rightSection",
    "disabled",
    "children",
    "className",
    "style",
    "id",
    "data-testid",
  ]);
  const { value, onChange } = useTabsContext();
  const active = createMemo(() => value() === known.value);

  const handleClick = () => {
    if (known.disabled) return;
    onChange?.(known.value);
  };

  const cls = createMemo(() =>
    cn(
      "ui-tab",
      "inline-flex items-center justify-center gap-1.5 px-3 min-h-[30px] text-[11px] font-medium tracking-[0.02em] leading-none transition-colors outline-none focus-visible:ring-1 focus-visible:ring-fin-primary",
      // Full-height underline instead of a border-bottom on the button: it reads as
      // one continuous rule with the strip, not a floating chip.
      "border-b-2 -mb-px",
      active()
        ? "text-fin-text font-semibold border-fin-primary"
        : "text-fin-text-muted border-transparent hover:bg-fin-surface-alt hover:text-fin-text",
      known.disabled ? "opacity-50 cursor-default" : "cursor-pointer",
      known.className,
    ),
  );

  return (
    <button
      id={known.id}
      role="tab"
      aria-selected={active()}
      data-testid={known["data-testid"]}
      disabled={known.disabled}
      tabIndex={active() ? 0 : -1}
      className={cls()}
      style={known.style as Record<string, string | undefined>}
      onClick={handleClick}
      {...(rest as Record<string, unknown>)}
    >
      <span className="flex items-center gap-1">{known.leftSection ?? known.icon}{known.children}{known.rightSection}</span>
    </button>
  );
}

export function TabsPanel(props: UITabsPanelProps) {
  const [known, rest] = splitProps(props, ["value", "keepMounted", "children", "className", "style", "id", "data-testid"]);
  const { value } = useTabsContext();
  const isActive = createMemo(() => value() === known.value);
  const cls = cn("ui-tabs-panel", "py-1 min-w-0 min-h-0", known.className);

  return (
    <Show when={isActive() || known.keepMounted}>
      <div
        id={known.id}
        role="tabpanel"
        hidden={!isActive()}
        className={cls}
        style={known.style as Record<string, string | undefined>}
        data-testid={known["data-testid"]}
        {...(rest as Record<string, unknown>)}
      >
        {known.children}
      </div>
    </Show>
  );
}

Tabs.List = TabsList;
Tabs.Tab = Tab;
Tabs.Panel = TabsPanel;

import * as React from "react";
import { cn } from "../cn";
import type { UITabsProps, UITabProps, UITabsPanelProps } from "../types";

type TabsContextValue = {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
};

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("Tabs compound components must be used within Tabs");
  return ctx;
}

export function Tabs({
  value,
  defaultValue,
  onChange,
  variant: _variant,
  orientation = "horizontal",
  children,
  className,
  style,
  id,
  "data-testid": testId,
  ...rest
}: UITabsProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState<string | null | undefined>(defaultValue ?? null);
  const activeValue = isControlled ? value : internal;

  const handleChange = React.useCallback(
    (v: string | null) => {
      if (!isControlled) setInternal(v);
      onChange?.(v);
    },
    [isControlled, onChange]
  );

  const ctxValue: TabsContextValue = { value: activeValue as any, onChange: handleChange };

  const cls = cn(
    "ui-tabs-wrapper",
    orientation === "vertical" ? "flex flex-col" : "flex flex-row",
    className,
  );

  return (
    <TabsContext.Provider value={ctxValue}>
      <div id={id} className={cls} style={style} data-testid={testId} {...(rest as any)}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export function TabsList({
  orientation = "horizontal",
  children,
  className,
  style,
  id,
  "data-testid": testId,
  ...rest
}: UITabsProps) {

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
    orientation === "vertical" ? "flex-col" : "flex flex-row items-center",
    "gap-1 rounded-fin border border-fin-border bg-fin-surface p-[2px] min-h-[36px]",
    className,
  );

  return (
    <div
      id={id}
      role="tablist"
      aria-orientation={orientation}
      className={cls}
      style={style}
      data-testid={testId}
      onKeyDown={handleKeyDown}
      {...(rest as any)}
    >
      {children}
    </div>
  );
}

export function Tab({
  value: tabValue,
  icon,
  leftSection,
  rightSection,
  disabled,
  children,
  className,
  style,
  id,
  "data-testid": testId,
  ...rest
}: UITabProps) {
  const { value, onChange } = useTabsContext();
  const active = value === tabValue;

  const handleClick = (_e: React.MouseEvent) => {
    if (disabled) return;
    onChange?.(tabValue);
  };

  const cls = cn(
    "ui-tab",
    "inline-flex items-center justify-center gap-1.5 rounded-[4px] px-2 py-[4px] min-h-[36px] text-[13px] font-medium transition-colors outline-none focus-visible:ring-1 focus-visible:ring-fin-primary focus-visible:ring-offset-1",
    active ? "bg-fin-surface-alt text-fin-primary" : "text-fin-text-muted hover:bg-fin-surface-alt hover:text-fin-text",
    disabled ? "opacity-50 cursor-default" : "cursor-pointer",
    className,
  );

  return (
    <button
      id={id}
      role="tab"
      aria-selected={active}
      data-testid={testId}
      disabled={disabled}
      tabIndex={active ? 0 : -1}
      className={cls}
      style={style}
      onClick={handleClick}
      {...(rest as any)}
    >
      <span className="flex items-center gap-1.5">{leftSection ?? icon}{children}{rightSection}</span>
    </button>
  );
}

export function TabsPanel({
  value: panelValue,
  keepMounted,
  children,
  className,
  style,
  id,
  "data-testid": testId,
  ...rest
}: UITabsPanelProps) {
  const { value } = useTabsContext();
  const isActive = value === panelValue;
  const cls = cn("ui-tabs-panel", "py-3 min-w-0 min-h-0", className);
  if (!isActive && !keepMounted) return null;

  return (
    <div id={id} role="tabpanel" hidden={!isActive} className={cls} style={style} data-testid={testId} {...(rest as any)}>
      {children}
    </div>
  );
}

Tabs.List = TabsList;
Tabs.Tab = Tab;
Tabs.Panel = TabsPanel;

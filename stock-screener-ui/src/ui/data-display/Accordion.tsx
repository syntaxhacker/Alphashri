import * as React from "react";
import { cn } from "../cn";
import type { UIAccordionProps, UIAccordionItemProps, UIAccordionControlProps, UIAccordionPanelProps } from "../types";

type AccordionContextValue = {
  multiple?: boolean;
  value: string | string[] | undefined | null;
  onChange: (v: string | string[]) => void;
  variant?: string;
  chevronPosition?: string;
  disableChevronRotation?: boolean;
};

const AccordionContext = React.createContext<AccordionContextValue | null>(null);

const AccordionItemContext = React.createContext<{ value: string; expanded: boolean; toggle: () => void } | null>(null);

function useAccordionContext() {
  const ctx = React.useContext(AccordionContext);
  if (!ctx) throw new Error("Accordion compound components must be used within Accordion");
  return ctx;
}
function useAccordionItemContext() {
  const ctx = React.useContext(AccordionItemContext);
  if (!ctx) throw new Error("AccordionControl/Panel must be used within AccordionItem");
  return ctx;
}

function isExpanded(accordionValue: string | string[] | null | undefined, itemValue: string): boolean {
  if (accordionValue == null) return false;
  if (Array.isArray(accordionValue)) return accordionValue.includes(itemValue);
  return accordionValue === itemValue;
}

function Chevron({ expanded, disableRotation }: { expanded: boolean; disableRotation?: boolean }) {
  const rotate = expanded && !disableRotation ? 180 : 0;
  return (
    <svg
      className="w-[20px] h-[20px] shrink-0 text-fin-text-muted transition-transform duration-200"
      style={{ transform: rotate ? `rotate(${rotate}deg)` : undefined }}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 10l5 5 5-5" />
    </svg>
  );
}

export function Accordion({
  multiple,
  defaultValue,
  value,
  onChange,
  variant,
  chevronPosition,
  disableChevronRotation,
  children,
  className,
  style,
  id,
  "data-testid": testId,
  ...rest
}: UIAccordionProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState<string | string[] | null | undefined>(
    (defaultValue as any) ?? (multiple ? [] : null)
  );
  const current = isControlled ? value : internal;

  const handleChange = React.useCallback(
    (next: string | string[]) => {
      if (!isControlled) setInternal(next as any);
      onChange?.(next as any);
    },
    [isControlled, onChange]
  );

  const ctx: AccordionContextValue = { multiple, value: current as any, onChange: handleChange, variant, chevronPosition, disableChevronRotation };

  const cls = cn(
    "ui-accordion",
    variant === "separated" ? "flex flex-col gap-2" : "",
    variant === "contained" ? "rounded-fin border border-fin-border" : "",
    className,
  );

  return (
    <AccordionContext.Provider value={ctx}>
      <div id={id} className={cls} style={style} data-testid={testId} {...(rest as any)}>
        {children}
      </div>
    </AccordionContext.Provider>
  );
}

export function AccordionItem({ value: itemValue, children, className, style, id, "data-testid": testId, ...rest }: UIAccordionItemProps) {
  const { value, multiple, onChange } = useAccordionContext();
  const expanded = isExpanded(value as any, itemValue, multiple);

  const toggle = React.useCallback(() => {
    if (multiple) {
      const arr = Array.isArray(value) ? [...value] : value != null ? [value as string] : [];
      const next = expanded ? arr.filter((v) => v !== itemValue) : [...arr, itemValue];
      onChange(next);
    } else {
      const next = expanded ? "" : itemValue;
      onChange(next as any);
    }
  }, [value, multiple, expanded, itemValue, onChange]);

  const itemCls = cn(
    "ui-accordion-item",
    variant === "filled" ? "bg-fin-surface-alt" : "",
    className
  );

  return (
    <AccordionItemContext.Provider value={{ value: itemValue, expanded, toggle }}>
      // The item wrapper stays visible so the control remains clickable; only the panel
      // content is hidden when collapsed (handled in AccordionPanel).
      <div id={id} className={itemCls} style={style} data-testid={testId} {...(rest as any)}>
        {children}
      </div>
    </AccordionItemContext.Provider>
  );
}

export function AccordionControl({ children, className, style, id, "data-testid": testId, ...rest }: UIAccordionControlProps) {
  const { expanded, toggle } = useAccordionItemContext();
  const { chevronPosition, disableChevronRotation } = useAccordionContext();
  const isLeft = chevronPosition === "left";

  const cls = cn(
    "ui-accordion-control",
    "flex w-full items-center gap-2 px-3 py-[6px] text-left text-[14px] font-medium text-fin-text bg-transparent border-none outline-none focus-visible:ring-1 focus-visible:ring-fin-primary cursor-pointer hover:bg-fin-surface-alt",
    className,
  );

  return (
    <button type="button" id={id} aria-expanded={expanded} className={cls} style={style} data-testid={testId} onClick={toggle} {...(rest as any)}>
      {isLeft && <Chevron expanded={expanded} disableRotation={disableChevronRotation} />}
      <span className="flex-1 min-w-0">{children}</span>
      {!isLeft && <Chevron expanded={expanded} disableRotation={disableChevronRotation} />}
    </button>
  );
}

export function AccordionPanel({ children, className, style, id, "data-testid": testId, ...rest }: UIAccordionPanelProps) {
  const { expanded } = useAccordionItemContext();
  // Only the panel content is hidden when collapsed; the control stays visible in the item wrapper.
  const cls = cn("ui-accordion-panel", "pt-1 pb-2", className);
  return <div id={id} hidden={!expanded} className={cls} style={style} data-testid={testId} {...(rest as any)}>{children}</div>;
}

Accordion.Item = AccordionItem;
Accordion.Control = AccordionControl;
Accordion.Panel = AccordionPanel;

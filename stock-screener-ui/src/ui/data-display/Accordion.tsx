import { createContext, createMemo, Show, splitProps, useContext } from "solid-js";
import { cn } from "../cn";
import type { UIAccordionProps, UIAccordionItemProps, UIAccordionControlProps, UIAccordionPanelProps } from "../types";

type AccordionContextValue = {
  multiple: () => boolean | undefined;
  value: () => string | string[] | undefined | null;
  onChange: (v: string | string[]) => void;
  variant: () => string | undefined;
  chevronPosition: () => string | undefined;
  disableChevronRotation: () => boolean | undefined;
};

type AccordionItemContextValue = {
  value: string;
  expanded: () => boolean;
  toggle: () => void;
};

const AccordionContext = createContext<AccordionContextValue | null>(null);
const AccordionItemContext = createContext<AccordionItemContextValue | null>(null);

function useAccordionContext() {
  const ctx = useContext(AccordionContext);
  if (!ctx) throw new Error("Accordion compound components must be used within Accordion");
  return ctx;
}
function useAccordionItemContext() {
  const ctx = useContext(AccordionItemContext);
  if (!ctx) throw new Error("AccordionControl/Panel must be used within AccordionItem");
  return ctx;
}

function isExpanded(accordionValue: string | string[] | null | undefined, itemValue: string): boolean {
  if (accordionValue == null) return false;
  if (Array.isArray(accordionValue)) return accordionValue.includes(itemValue);
  return accordionValue === itemValue;
}

function Chevron({ expanded, disableRotation }: { expanded: () => boolean; disableRotation?: () => boolean | undefined }) {
  const rotate = expanded() && !disableRotation() ? 180 : 0;
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

export function Accordion(props: UIAccordionProps) {
  const [known, rest] = splitProps(props, [
    "multiple",
    "defaultValue",
    "value",
    "onChange",
    "variant",
    "chevronPosition",
    "disableChevronRotation",
    "children",
    "className",
    "style",
    "id",
    "data-testid",
  ]);

  const isControlled = createMemo(() => known.value !== undefined);
  const internal = createSignal<string | string[] | null | undefined>(
    known.defaultValue ?? (known.multiple ? [] : null),
  );
  const [internalValue, setInternalValue] = internal;
  const current = createMemo(() => (isControlled() ? known.value : internalValue()));

  const handleChange = (next: string | string[]) => {
    if (!isControlled()) setInternalValue(next as any);
    known.onChange?.(next as any);
  };

  const ctx: AccordionContextValue = {
    multiple: () => known.multiple,
    value: current,
    onChange: handleChange,
    variant: () => known.variant,
    chevronPosition: () => known.chevronPosition,
    disableChevronRotation: () => known.disableChevronRotation,
  };

  const cls = cn(
    "ui-accordion",
    known.variant === "separated" ? "flex flex-col gap-2" : "",
    known.variant === "contained" ? "rounded-fin border border-fin-border" : "",
    known.className,
  );

  return (
    <AccordionContext.Provider value={ctx}>
      <div
        id={known.id}
        className={cls}
        style={known.style as Record<string, string | undefined>}
        data-testid={known["data-testid"]}
        {...(rest as Record<string, unknown>)}
      >
        {known.children}
      </div>
    </AccordionContext.Provider>
  );
}

export function AccordionItem(props: UIAccordionItemProps) {
  const [known, rest] = splitProps(props, ["value", "children", "className", "style", "id", "data-testid"]);
  const { value, multiple, onChange, variant } = useAccordionContext();
  const itemValue = known.value;
  const expanded = createMemo(() => isExpanded(value(), itemValue));

  const toggle = () => {
    if (multiple()) {
      const arr = Array.isArray(value()) ? [...value()] : value() != null ? [value()] : [];
      const next = expanded() ? arr.filter((v) => v !== itemValue) : [...arr, itemValue];
      onChange(next);
    } else {
      onChange(expanded() ? "" : itemValue);
    }
  };

  const itemCls = cn(
    "ui-accordion-item",
    variant() === "filled" ? "bg-fin-surface-alt" : "",
    known.className,
  );

  return (
    <AccordionItemContext.Provider value={{ value: itemValue, expanded, toggle }}>
      <div
        id={known.id}
        className={itemCls}
        style={known.style as Record<string, string | undefined>}
        data-testid={known["data-testid"]}
        {...(rest as Record<string, unknown>)}
      >
        {known.children}
      </div>
    </AccordionItemContext.Provider>
  );
}

export function AccordionControl(props: UIAccordionControlProps) {
  const [known, rest] = splitProps(props, ["children", "className", "style", "id", "data-testid"]);
  const { expanded, toggle } = useAccordionItemContext();
  const { chevronPosition, disableChevronRotation } = useAccordionContext();
  const isLeft = chevronPosition() === "left";

  const cls = cn(
    "ui-accordion-control",
    "flex w-full items-center gap-2 px-3 py-[6px] text-left text-[14px] font-medium text-fin-text bg-transparent border-none outline-none focus-visible:ring-1 focus-visible:ring-fin-primary cursor-pointer hover:bg-fin-surface-alt",
    known.className,
  );

  return (
    <button
      type="button"
      id={known.id}
      aria-expanded={expanded()}
      className={cls}
      style={known.style as Record<string, string | undefined>}
      data-testid={known["data-testid"]}
      onClick={toggle}
      {...(rest as Record<string, unknown>)}
    >
      <Show when={isLeft()}>
        <Chevron expanded={expanded} disableRotation={disableChevronRotation} />
      </Show>
      <span className="flex-1 min-w-0">{known.children}</span>
      <Show when={!isLeft()}>
        <Chevron expanded={expanded} disableRotation={disableChevronRotation} />
      </Show>
    </button>
  );
}

export function AccordionPanel(props: UIAccordionPanelProps) {
  const [known, rest] = splitProps(props, ["children", "className", "style", "id", "data-testid"]);
  const { expanded } = useAccordionItemContext();
  const cls = cn("ui-accordion-panel", "pt-1 pb-2", known.className);
  return (
    <div
      id={known.id}
      hidden={!expanded()}
      className={cls}
      style={known.style as Record<string, string | undefined>}
      data-testid={known["data-testid"]}
      {...(rest as Record<string, unknown>)}
    >
      {known.children}
    </div>
  );
}

Accordion.Item = AccordionItem;
Accordion.Control = AccordionControl;
Accordion.Panel = AccordionPanel;

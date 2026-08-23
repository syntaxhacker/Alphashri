import * as React from "react";
import MuiAccordion from "@mui/material/Accordion";
import MuiAccordionSummary from "@mui/material/AccordionSummary";
import MuiAccordionDetails from "@mui/material/AccordionDetails";
import Box from "@mui/material/Box";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
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

function isExpanded(accordionValue: string | string[] | null | undefined, itemValue: string, multiple?: boolean): boolean {
  if (accordionValue == null) return false;
  if (Array.isArray(accordionValue)) return accordionValue.includes(itemValue);
  return accordionValue === itemValue;
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

  return (
    <AccordionContext.Provider value={ctx}>
      <Box
        className={className}
        style={style}
        data-testid={testId}
        sx={{
          ...(variant === "separated" ? { display: "flex", flexDirection: "column", gap: 1 } : {}),
          ...(variant === "contained" ? { border: "1px solid", borderColor: "divider", borderRadius: 1, overflow: "hidden" } : {}),
        }}
        {...(rest as any)}
      >
        {children}
      </Box>
    </AccordionContext.Provider>
  );
}

export function AccordionItem({ value: itemValue, children, className, style, "data-testid": testId, ...rest }: UIAccordionItemProps) {
  const { value, multiple, onChange, variant } = useAccordionContext();
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

  return (
    <AccordionItemContext.Provider value={{ value: itemValue, expanded, toggle }}>
      <MuiAccordion
        expanded={expanded}
        onChange={toggle}
        className={className}
        style={style}
        data-testid={testId}
        disableGutters
        square={variant === "separated" ? false : undefined}
        sx={{
          ...(variant === "separated" ? { border: "1px solid", borderColor: "divider", borderRadius: 1, "&:before": { display: "none" } } : {}),
          ...(variant === "filled" ? { bgcolor: "action.hover" } : {}),
        }}
        {...(rest as any)}
      >
        {children}
      </MuiAccordion>
    </AccordionItemContext.Provider>
  );
}

export function AccordionControl({ children, className, style, "data-testid": testId, ...rest }: UIAccordionControlProps) {
  const { expanded, toggle } = useAccordionItemContext();
  const { chevronPosition, disableChevronRotation } = useAccordionContext();
  const isLeft = chevronPosition === "left";
  return (
    <MuiAccordionSummary
      expandIcon={<ExpandMoreIcon sx={{ transition: "transform 0.2s", transform: expanded && !disableChevronRotation ? "rotate(180deg)" : "none" }} />}
      onClick={toggle}
      className={className}
      style={style}
      data-testid={testId}
      sx={{ flexDirection: isLeft ? "row" : "row", minHeight: 48, ...(isLeft ? { "& .MuiAccordionSummary-expandIconWrapper": { order: -1, mr: 1 } } : {}) }}
      {...(rest as any)}
    >
      <Box sx={{ flex: 1 }}>{children}</Box>
    </MuiAccordionSummary>
  );
}

export function AccordionPanel({ children, className, style, "data-testid": testId, ...rest }: UIAccordionPanelProps) {
  // No need for item context except for styling
  return (
    <MuiAccordionDetails className={className} style={style} data-testid={testId} {...(rest as any)}>
      {children}
    </MuiAccordionDetails>
  );
}

Accordion.Item = AccordionItem;
Accordion.Control = AccordionControl;
Accordion.Panel = AccordionPanel;

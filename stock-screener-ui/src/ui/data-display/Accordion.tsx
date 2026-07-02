import { Accordion as MantineAccordion } from "@mantine/core";
import type { UIAccordionProps, UIAccordionItemProps, UIAccordionControlProps, UIAccordionPanelProps } from "../types";

export function Accordion({ multiple, defaultValue, value, onChange, variant, chevronPosition, disableChevronRotation, children, className, style, "data-testid": testId, ...rest }: UIAccordionProps) {
  return <MantineAccordion multiple={multiple} defaultValue={defaultValue} value={value} onChange={onChange} variant={variant} chevronPosition={chevronPosition} disableChevronRotation={disableChevronRotation} className={className} style={style} data-testid={testId} {...rest}>{children}</MantineAccordion>;
}

export function AccordionItem({ value, children, className, style, "data-testid": testId, ...rest }: UIAccordionItemProps) {
  return <MantineAccordion.Item value={value} className={className} style={style} data-testid={testId} {...rest}>{children}</MantineAccordion.Item>;
}

export function AccordionControl({ children, className, style, "data-testid": testId, ...rest }: UIAccordionControlProps) {
  return <MantineAccordion.Control className={className} style={style} data-testid={testId} {...rest}>{children}</MantineAccordion.Control>;
}

export function AccordionPanel({ children, className, style, "data-testid": testId, ...rest }: UIAccordionPanelProps) {
  return <MantineAccordion.Panel className={className} style={style} data-testid={testId} {...rest}>{children}</MantineAccordion.Panel>;
}
Accordion.Item = AccordionItem;
Accordion.Control = AccordionControl;
Accordion.Panel = AccordionPanel;

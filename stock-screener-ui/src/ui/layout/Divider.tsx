import { cn } from "../cn";
import type { UIDividerProps } from "../types";

/**
 * `props` also carries the Mantine-shaped keys (`orientation`, `label`,
 * `labelPosition`, `size`, `color`, `flexItem`). Spreading it painted them onto
 * the element as invalid DOM attributes and, on the vertical branch, re-inserted
 * `children` next to the label that is already rendered.
 */
function ariaAttributes(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (key.startsWith("aria-")) out[key] = props[key];
  }
  return out;
}

export function Divider(props: UIDividerProps & Record<string, unknown>) {
  void props.color; void props.size; void props.flexItem; void props.labelPosition;
  const vertical = props.orientation === "vertical";
  const base = vertical ? "h-full border-r border-fin-border" : "border-fin-border";
  const forwarded = ariaAttributes(props as Record<string, unknown>);

  if (vertical) {
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        id={props.id}
        className={cn(base, props.className)}
        style={props.style}
        data-testid={props["data-testid"]}
        {...forwarded}
      >
        {props.label ?? props.children}
      </div>
    );
  }
  return (
    <hr
      id={props.id}
      className={cn(base, props.className)}
      style={props.style}
      data-testid={props["data-testid"]}
      {...forwarded}
    />
  );
}

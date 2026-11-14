import { cn } from "../cn";
import type { UIDividerProps } from "../types";

export function Divider(props: UIDividerProps & Record<string, unknown>) {
  void props.color; void props.size; void props.flexItem; void props.labelPosition;
  const vertical = props.orientation === "vertical";
  const base = vertical ? "h-full border-r border-fin-border" : "border-fin-border";

  if (vertical) {
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        id={props.id}
        className={cn(base, props.className)}
        style={props.style}
        data-testid={props["data-testid"]}
        {...(props as Record<string, unknown>)}
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
      {...(props as Record<string, unknown>)}
    />
  );
}

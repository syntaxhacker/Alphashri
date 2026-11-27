import { splitProps } from "solid-js";
import { cn } from "../cn";
import type { UICenterProps } from "../types";

const CENTER_KNOWN = ["children", "className", "style", "id", "data-testid", "inline"] as const;

export function Center(props: UICenterProps & Record<string, unknown>) {
  const [known, rest] = splitProps(props, CENTER_KNOWN);

  return (
    <div
      id={known.id}
      className={cn(known.inline ? "inline-flex" : "flex", "items-center", "justify-center", known.className)}
      style={known.style}
      data-testid={known["data-testid"]}
      {...rest}
    >
      {known.children}
    </div>
  );
}

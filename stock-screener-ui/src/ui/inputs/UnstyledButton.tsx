import { cn } from "../cn";
import type { UIUnstyledButtonProps } from "../types";

export function UnstyledButton(props: UIUnstyledButtonProps) {
  return (
    <button
      type="button"
      id={props.id}
      className={cn(props.className)}
      style={props.style}
      onClick={(e) => props.onClick?.(e)}
      data-testid={props["data-testid"]}
    >
      {props.children}
    </button>
  );
}

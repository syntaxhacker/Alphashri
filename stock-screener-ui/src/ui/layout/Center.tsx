import { cn } from "../cn";
import type { UICenterProps } from "../types";

export function Center({ children, className, style, id, "data-testid": testId, inline, ...rest }: UICenterProps & Record<string, unknown>) {
  return (
    <div
      id={id as string}
      className={cn(inline ? "inline-flex" : "flex", "items-center", "justify-center", className)}
      style={style}
      data-testid={testId}
      {...rest}
    >
      {children}
    </div>
  );
}

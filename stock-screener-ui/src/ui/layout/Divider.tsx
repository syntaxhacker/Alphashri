import { cn } from "../cn";
import type { UIDividerProps } from "../types";

export function Divider({ children, className, style, id, "data-testid": testId, orientation, color, size, label, labelPosition, flexItem, ...rest }: UIDividerProps & Record<string, unknown>) {
  void color; void size; void flexItem; void labelPosition;
  const vertical = orientation === "vertical";
  const base = vertical ? "h-full border-r border-fin-border" : "border-fin-border";
  if (vertical) {
    return (
      <div
        role="separator" aria-orientation="vertical"
        id={id}
        className={cn(base, className)}
        style={style}
        data-testid={testId}
        {...rest}
      >
        {label ?? children}
      </div>
    );
  }
  return (
    <hr
      id={id}
      className={cn(base, className)}
      style={style}
      data-testid={testId}
      {...rest}
    />
  );
}

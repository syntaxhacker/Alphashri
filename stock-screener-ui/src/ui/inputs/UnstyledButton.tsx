import { cn } from "../cn";
import type { UIUnstyledButtonProps } from "../types";

export function UnstyledButton({
  children,
  className,
  style,
  onClick,
  "data-testid": testId,
  id,
  ...rest
}: UIUnstyledButtonProps) {
  return (
    <button
      type="button"
      id={id}
      className={cn(className)}
      style={style}
      onClick={onClick}
      data-testid={testId}
      {...rest}
    >
      {children}
    </button>
  );
}

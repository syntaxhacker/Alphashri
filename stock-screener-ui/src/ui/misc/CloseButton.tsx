import { cn } from "../cn";
import type { UICloseButtonProps } from "../types";

function mapSize(size: UICloseButtonProps["size"]): { w: string; h: string; text: string } {
  if (size == null) return { w: "w-6", h: "h-6", text: "text-sm" };
  if (typeof size === "number") {
    if (size <= 24) return { w: "w-5", h: "h-5", text: "text-xs" };
    if (size >= 36) return { w: "w-8", h: "h-8", text: "text-base" };
    return { w: "w-6", h: "h-6", text: "text-sm" };
  }
  switch (size) {
    case "xs":
    case "sm":
      return { w: "w-5", h: "h-5", text: "text-xs" };
    case "lg":
    case "xl":
      return { w: "w-8", h: "h-8", text: "text-base" };
    case "md":
    default:
      return { w: "w-6", h: "h-6", text: "text-sm" };
  }
}

function variantClass(variant: UICloseButtonProps["variant"]): string {
  switch (variant) {
    case "filled":
      return "bg-fin-surface text-fin-text hover:bg-fin-surface-alt";
    case "light":
      return "bg-fin-surface-alt text-fin-text hover:bg-fin-surface";
    case "outline":
      return "bg-transparent text-fin-text border border-fin-border hover:bg-fin-surface-alt";
    case "subtle":
      return "bg-transparent text-fin-text-muted hover:bg-fin-surface-alt hover:text-fin-text";
    case "transparent":
    default:
      return "bg-transparent text-fin-text hover:bg-fin-surface-alt";
  }
}

export function CloseButton({ size, variant, disabled, onClick, className, style, "data-testid": testId, id, ...rest }: UICloseButtonProps) {
  const { w, h, text } = mapSize(size);
  return (
    <button
      type="button"
      aria-label="close"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center shrink-0 rounded-fin border border-transparent",
        w,
        h,
        text,
        variantClass(variant),
        disabled && "opacity-50 pointer-events-none",
        className,
      )}
      style={style}
      id={id}
      data-testid={testId}
      {...(rest as Record<string, unknown>)}
    >
      <span aria-hidden="true" className="leading-none">
        ×
      </span>
    </button>
  );
}

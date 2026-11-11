import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "../cn";
import type { UIModalProps, UISize } from "../types";

type ModalProps = UIModalProps;

const SIZE_MAX_WIDTH: Record<string, string> = {
  xs: "max-w-xs",
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
};

function paddingSize(v: UISize | number | string): string {
  if (typeof v === "number") return `${v * 8}px`;
  const m: Record<string, string> = { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" };
  return m[v as string] ?? String(v);
}

export function Modal({
  children,
  opened,
  onClose,
  title,
  size,
  fullScreen,
  _centered,
  withCloseButton = true,
  closeOnClickOutside = true,
  closeOnEscape = true,
  overlayProps,
  padding,
  _transitionProps,
  className,
  style,
  id,
  "data-testid": testId,
  ...rest
}: ModalProps) {
  const dialogRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!opened) return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closeOnEscape) onClose();
    };
    document.addEventListener("keydown", onDocKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onDocKey);
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    };
  }, [opened, closeOnEscape, onClose]);

  if (!opened) return null;

  const isPreset = typeof size === "string" && size in SIZE_MAX_WIDTH;
  const maxWidthClass = isPreset ? SIZE_MAX_WIDTH[size] : undefined;
  const maxWidthStyle =
    !isPreset && size != null ? (typeof size === "number" ? `${size}px` : String(size)) : undefined;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && closeOnEscape) onClose();
  };
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && closeOnClickOutside) onClose();
  };

  const overlayStyle: React.CSSProperties = {
    backgroundColor: overlayProps?.color ?? undefined,
    opacity: overlayProps?.opacity != null ? overlayProps.opacity : undefined,
    backdropFilter:
      overlayProps?.blur != null
        ? `blur(${typeof overlayProps.blur === "number" ? `${overlayProps.blur}px` : overlayProps.blur})`
        : undefined,
  };

  const panelStyle: React.CSSProperties = {
    ...(maxWidthStyle ? { maxWidth: maxWidthStyle } : {}),
    ...(fullScreen
      ? { position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }
      : {}),
    ...style,
  };

  return createPortal(
    <div
      ref={dialogRef}
      id={id}
      data-testid={testId}
      className={cn("fixed inset-0 z-50 flex items-center justify-center", className)}
      style={overlayStyle}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : "dialog"}
      tabIndex={-1}
      {...(rest as Record<string, unknown>)}
    >
      <div
        className={cn(
          "relative bg-fin-surface border border-fin-border rounded-sm shadow-2xl flex flex-col w-full",
          maxWidthClass,
          fullScreen ? "absolute inset-0 w-full h-full max-w-none rounded-none border-0" : undefined,
        )}
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || withCloseButton) && (
          <div className="relative flex items-center justify-between border-b border-fin-border bg-fin-surface/50 px-3 py-2">
            {title && (
              <div
                className={cn(
                  "flex-1 text-sm font-medium text-fin-text truncate",
                  withCloseButton ? "pr-8" : undefined,
                )}
              >
                {title}
              </div>
            )}
            {withCloseButton && (
              <button
                type="button"
                aria-label="close"
                data-testid={testId ? `${testId}-close` : undefined}
                onClick={onClose}
                className="absolute right-3 top-1/2 -translate-y-1/2 flex size-6 items-center justify-center rounded text-fin-text-muted hover:text-fin-text hover:bg-fin-border focus:outline-none"
              >
                ×
              </button>
            )}
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-auto" style={{ padding: padding != null ? paddingSize(padding) : undefined }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

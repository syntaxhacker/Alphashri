import { createEffect, onCleanup, Show, splitProps } from "solid-js";
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

export function Modal(props: ModalProps) {
  // splitProps reads are reactive only while they stay inside a tracked scope
  // (JSX or an effect). Destructuring them here would pin the first snapshot.
  const [known, rest] = splitProps(props, [
    "children",
    "opened",
    "onClose",
    "title",
    "size",
    "fullScreen",
    "withCloseButton",
    "closeOnClickOutside",
    "closeOnEscape",
    "overlayProps",
    "padding",
    "transitionProps",
    "className",
    "style",
    "id",
    "data-testid",
    "onClick",
    "onMouseEnter",
    "onMouseLeave",
  ]);

  // The testid travels with the dialog, so the close button can derive its own.
  const testId = known["data-testid"];

  let dialogRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (!known.opened) return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => dialogRef?.focus());
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && known.closeOnEscape) known.onClose?.();
    };
    document.addEventListener("keydown", onDocKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    onCleanup(() => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onDocKey);
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    });
  });

  const size = known.size;
  const isPreset = typeof size === "string" && size in SIZE_MAX_WIDTH;
  const maxWidthClass = isPreset ? SIZE_MAX_WIDTH[size as string] : undefined;
  const maxWidthStyle =
    !isPreset && known.size != null
      ? typeof known.size === "number"
        ? `${known.size}px`
        : String(known.size)
      : undefined;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && known.closeOnEscape) known.onClose?.();
  };
  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget && known.closeOnClickOutside) known.onClose?.();
  };

  const overlayStyle: Record<string, string | number | undefined> = {
    "background-color": known.overlayProps?.color ?? undefined,
    opacity: known.overlayProps?.opacity != null ? known.overlayProps.opacity : undefined,
    "backdrop-filter":
      known.overlayProps?.blur != null
        ? `blur(${typeof known.overlayProps.blur === "number" ? `${known.overlayProps.blur}px` : known.overlayProps.blur})`
        : undefined,
  };

  const panelStyle: Record<string, string | number | undefined> = {
    ...(maxWidthStyle ? { "max-width": maxWidthStyle } : {}),
    ...(known.fullScreen
      ? { position: "absolute", top: "0px", left: "0px", width: "100%", height: "100%" }
      : { "max-height": "calc(100dvh - 32px)" }),
    ...known.style,
  };

  return (
    <Show when={known.opened}>
      <div
        ref={(el) => (dialogRef = el)}
        id={known.id}
        data-testid={testId}
        className={cn("fixed inset-0 z-50 flex items-center justify-center", known.className)}
        style={overlayStyle}
        onClick={handleBackdropClick}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={typeof known.title === "string" ? known.title : "dialog"}
        tabIndex={-1}
        {...(rest as Record<string, unknown>)}
      >
        <div
          className={cn(
            "relative bg-fin-surface border border-fin-border rounded-sm shadow-2xl flex flex-col w-full",
            maxWidthClass,
            known.fullScreen ? "absolute inset-0 w-full h-full max-w-none rounded-none border-0" : undefined,
          )}
          style={panelStyle}
          onClick={(e) => e.stopPropagation()}
        >
          <Show when={known.title || known.withCloseButton}>
            <div className="relative flex items-center justify-between border-b border-fin-border bg-fin-surface/50 px-3 py-2">
              {known.title && (
                <div
                  className={cn(
                    "flex-1 text-sm font-medium text-fin-text truncate",
                    known.withCloseButton ? "pr-8" : undefined,
                  )}
                >
                  {known.title}
                </div>
              )}
              {known.withCloseButton && (
                <button
                  type="button"
                  aria-label="close"
                  data-testid={testId ? `${testId}-close` : undefined}
                  onClick={() => known.onClose?.()}
                  className="absolute right-3 top-1/2 -translate-y-1/2 flex size-6 items-center justify-center rounded text-fin-text-muted hover:text-fin-text hover:bg-fin-border focus:outline-none"
                >
                  ×
                </button>
              )}
            </div>
          </Show>
          <div className="flex-1 min-h-0 overflow-auto" style={{
            "padding": known.padding != null ? paddingSize(known.padding) : undefined,
          }}
        >
          {known.children}
        </div>
        </div>
      </div>
    </Show>
  );
}

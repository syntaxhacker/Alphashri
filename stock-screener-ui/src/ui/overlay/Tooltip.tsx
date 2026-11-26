import { createEffect, createSignal, createUniqueId, onCleanup, splitProps } from "solid-js";
import { Portal } from "solid-js/web";
import { cn } from "../cn";
import * as palette from "../palette";
import type { UITooltipProps } from "../types";

type TooltipProps = UITooltipProps & {
  onFocus?: (e: FocusEvent) => void;
  onBlur?: (e: FocusEvent) => void;
  "aria-describedby"?: string;
};

type TooltipPosition = NonNullable<UITooltipProps["position"]>;

const ARROW_SIDE: Record<TooltipPosition, "t" | "r" | "b" | "l"> = {
  top: "b",
  bottom: "t",
  left: "r",
  right: "l",
  "top-start": "b",
  "top-end": "b",
  "bottom-start": "t",
  "bottom-end": "t",
  "left-start": "r",
  "left-end": "r",
  "right-start": "l",
  "right-end": "l",
};

type ArrowPos = { bottom?: string; left?: string; transform?: string; top?: string; right?: string };
const ARROW_POS: Record<TooltipPosition, ArrowPos> = {
  top: { bottom: "-10px", left: "50%", transform: "translateX(-50%)" },
  bottom: { top: "-10px", left: "50%", transform: "translateX(-50%)" },
  left: { right: "-10px", top: "50%", transform: "translateY(-50%)" },
  right: { left: "-10px", top: "50%", transform: "translateY(-50%)" },
  "top-start": { bottom: "-10px", left: "8px" },
  "top-end": { bottom: "-10px", right: "8px" },
  "bottom-start": { top: "-10px", left: "8px" },
  "bottom-end": { top: "-10px", right: "8px" },
  "left-start": { right: "-10px", top: "8px" },
  "left-end": { right: "-10px", bottom: "8px" },
  "right-start": { left: "-10px", top: "8px" },
  "right-end": { left: "-10px", bottom: "8px" },
};

/** Gap between the trigger and the floating box, in px. */
const GAP = 6;
/** Minimum distance from any viewport edge. */
const PAD = 8;

export function Tooltip(props: TooltipProps) {
  const [known, rest] = splitProps(props as typeof props & Record<string, unknown>, [
    "label",
    "withArrow",
    "position",
    "openDelay",
    "closeDelay",
    "disabled",
    "multiline",
    "color",
    "focusable",
    "children",
    "className",
    "style",
    "id",
    "data-testid",
    // Swallowed: the wrapper is generic only; callers name the trigger itself.
    "role",
    "aria-label",
    "onMouseEnter",
    "onMouseLeave",
    "onFocus",
    "onBlur",
    "aria-describedby",
    // Runtime swallow for older callers; no longer public API.
    "transitionProps",
  ]);

  const [open, setOpen] = createSignal(false);
  // Stable across renders; the floating copy only exists while open, but the
  // trigger must never point at an id that is not in the document.
  const tipId = createUniqueId();
  let timer: ReturnType<typeof setTimeout> | null = null;
  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });

  const enterMs = known.openDelay ?? 0;
  const leaveMs = known.closeDelay ?? 0;
  const show = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => setOpen(true), enterMs);
  };
  const hide = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => setOpen(false), leaveMs);
  };
  const hideNow = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    setOpen(false);
  };

  const placement: TooltipPosition = known.position ?? "top";

  /**
   * The floating box is portalled to <body> and positioned `fixed` from the
   * trigger's rect. An in-flow absolute child was clipped by any ancestor with
   * `overflow: hidden` — the market toolbar is exactly that, so its Stale/Live
   * tooltips were invisible even after flipping to "bottom".
   */
  const [pos, setPos] = createSignal<{ top: number; left: number; placement: TooltipPosition } | null>(null);
  let wrapEl: HTMLSpanElement | undefined;
  let tipEl: HTMLSpanElement | undefined;

  const place = () => {
    if (!wrapEl || !tipEl) return;
    const w = wrapEl.getBoundingClientRect();
    const t = tipEl.getBoundingClientRect();
    const need = t.height + GAP;

    // Flip to the side that has room; the requested side wins otherwise.
    let p = placement;
    if (p.startsWith("top") && w.top < need && window.innerHeight - w.bottom >= need) {
      p = p.replace("top", "bottom") as TooltipPosition;
    } else if (p.startsWith("bottom") && window.innerHeight - w.bottom < need && w.top >= need) {
      p = p.replace("bottom", "top") as TooltipPosition;
    }

    let top = p.startsWith("top") ? w.top - t.height - GAP : w.bottom + GAP;
    let left = p.endsWith("start")
      ? w.left
      : p.endsWith("end")
        ? w.right - t.width
        : w.left + w.width / 2 - t.width / 2;

    left = Math.max(PAD, Math.min(left, window.innerWidth - t.width - PAD));
    top = Math.max(PAD, Math.min(top, window.innerHeight - t.height - PAD));
    setPos({ top, left, placement: p });
  };

  createEffect(() => {
    if (!open()) {
      setPos(null);
      return;
    }
    // Render hidden first, then measure (visibility:hidden still lays out).
    queueMicrotask(place);
  });

  createEffect(() => {
    if (!open()) return;
    const onMove = () => place();
    window.addEventListener("resize", onMove);
    // Capture so nested scroll containers (the table) reposition too.
    window.addEventListener("scroll", onMove, true);
    onCleanup(() => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    });
  });

  if (known.disabled) return <>{known.children}</>;

  // The wrapper is a generic span: it carries no role and no aria-label. The
  // trigger keeps its own accessible name, and the label is exposed only as the
  // tooltip description via aria-describedby while the tooltip is open.

  /**
   * `focusable` is opt-in so buttons/links keep their single, native tab stop.
   * The wrapper is a focus target, not an action: it gets a tab stop and a ring
   * of its own, but deliberately no button role (there is no Enter/Space
   * activation). Focus alone reveals the description via aria-describedby.
   */
  const wrapperTabIndex = () => (known.focusable ? 0 : undefined);
  const focusRingClass = () =>
    known.focusable
      ? "outline-none focus:ring-1 focus:ring-fin-text focus-visible:ring-2"
      : undefined;

  /**
   * Only reference the portalled node while it is mounted. A caller-supplied
   * describedby is preserved (and appended to) rather than overwritten.
   */
  const describedBy = (): string | undefined => {
    const external = known["aria-describedby"];
    if (!open() || !known.label) return external;
    return external ? `${external} ${tipId}` : tipId;
  };

  /**
   * `focusin`/`focusout` are used as well as `focus`/`blur`: focus does not
   * bubble, so a keyboard user focusing the actual trigger element (a button
   * inside the wrapper) would otherwise never open the tooltip.
   */
  const handleFocus = (e: FocusEvent) => {
    // A wrapper that is itself focused emits both `focus` and `focusin`.
    if (e.type !== "focusin" || e.target !== wrapEl) known.onFocus?.(e);
    show();
  };
  const handleBlur = (e: FocusEvent) => {
    if (e.type !== "focusout" || e.target !== wrapEl) known.onBlur?.(e);
    const next = e.relatedTarget as Node | null;
    if (next && wrapEl?.contains(next)) return;
    hide();
  };

  // Escape is the documented dismissal key even though focus alone opens the
  // tooltip; dismiss immediately rather than waiting out a caller's closeDelay.
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") hideNow();
    (rest as { onKeyDown?: (e: KeyboardEvent) => void }).onKeyDown?.(e);
  };

  const activePlacement = (): TooltipPosition => pos()?.placement ?? placement;

  const arrowStyle = (): ArrowPos => {
    const p = activePlacement();
    const style: ArrowPos = { ...ARROW_POS[p] };
    const side = ARROW_SIDE[p];
    if (side && known.color) {
      const prop =
        side === "t"
          ? "borderTopColor"
          : side === "r"
            ? "borderRightColor"
            : side === "b"
              ? "borderBottomColor"
              : "borderLeftColor";
      (style as Record<string, string>)[prop] = known.color;
    }
    return style;
  };

  return (
    <span
      ref={(el) => {
        wrapEl = el;
      }}
      id={known.id}
      data-testid={known["data-testid"] ? `${known["data-testid"]}-wrapper` : undefined}
      className={cn("inline-flex relative", focusRingClass(), known.className)}
      style={known.style}
      onMouseEnter={(e) => {
        known.onMouseEnter?.(e);
        show();
      }}
      onMouseLeave={(e) => {
        known.onMouseLeave?.(e);
        hide();
      }}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onFocusIn={handleFocus}
      onFocusOut={handleBlur}
      {...(rest as Record<string, unknown>)}
      aria-describedby={describedBy()}
      tabIndex={wrapperTabIndex()}
      onKeyDown={handleKeyDown}
    >
      {known.children}
      {open() && known.label && (
        <Portal>
          <span
            ref={(el) => {
              tipEl = el;
            }}
            id={tipId}
            data-testid={known["data-testid"]}
            role="tooltip"
            className={cn(
              "fixed z-[1300]",
              "bg-fin-surface border border-fin-border text-fin-text rounded-sm text-xs px-2 py-1 shadow-md",
              known.color ? "text-white" : undefined,
              known.multiline ? "max-w-[280px] whitespace-normal" : "whitespace-nowrap",
            )}
            style={{
              top: `${pos()?.top ?? 0}px`,
              left: `${pos()?.left ?? 0}px`,
              visibility: pos() ? "visible" : "hidden",
              "background-color": known.color ?? undefined,
            }}
          >
            {known.label}
            {known.withArrow && (
              <span
                className="absolute w-0 h-0 border-[5px] border-transparent"
                style={{
                  [`border${ARROW_SIDE[activePlacement()] === "t" ? "Top" : ARROW_SIDE[activePlacement()] === "r" ? "Right" : ARROW_SIDE[activePlacement()] === "b" ? "Bottom" : "Left"}Color`]:
                    known.color ?? palette.BORDER,
                  ...arrowStyle(),
                }}
              />
            )}
          </span>
        </Portal>
      )}
    </span>
  );
}

// Preserve static members for compatibility (no-ops / wrappers)
(Tooltip as any).Group = ({ children }: { children?: any }) => <>{children}</>;
(Tooltip as any).Floating = Tooltip;

import { createEffect, createSignal, onCleanup, splitProps } from "solid-js";
import { cn } from "../cn";
import * as palette from "../palette";
import type { UITooltipProps } from "../types";

type TooltipProps = UITooltipProps & { transitionProps?: { duration?: number } };

type TooltipPosition = NonNullable<UITooltipProps["position"]>;

const PLACEMENT: Record<TooltipPosition, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-1",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-1",
  left: "right-full top-1/2 -translate-y-1/2 mb-1",
  right: "left-full top-1/2 -translate-y-1/2 mt-1",
  "top-start": "bottom-full left-0 mb-1",
  "top-end": "bottom-full right-0 mb-1",
  "bottom-start": "top-full left-0 mt-1",
  "bottom-end": "top-full right-0 mt-1",
};

const ARROW_SIDE: Record<TooltipPosition, "t" | "r" | "b" | "l"> = {
  top: "b",
  bottom: "t",
  left: "r",
  right: "l",
  "top-start": "b",
  "top-end": "b",
  "bottom-start": "t",
  "bottom-end": "t",
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
};

export function Tooltip(props: TooltipProps) {
  const [known, rest] = splitProps(props, [
    "label",
    "withArrow",
    "position",
    "openDelay",
    "closeDelay",
    "disabled",
    "multiline",
    "color",
    "children",
    "className",
    "style",
    "id",
    "data-testid",
    "onMouseEnter",
    "onMouseLeave",
    "withinPortal",
    "transitionProps",
  ]);

  const [open, setOpen] = createSignal(false);
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

  const placement: TooltipPosition = known.position ?? "top";

  // Flip to the other side when the requested one does not fit. The market
  // toolbar sits directly under the tab strip, so a "top" tooltip there was
  // rendered above the viewport and clipped; call sites should not have to
  // know the page chrome.
  const [flipped, setFlipped] = createSignal(false);
  const [shiftX, setShiftX] = createSignal(0);
  let placed = false;
  let wrapEl: HTMLSpanElement | undefined;
  let tipEl: HTMLSpanElement | undefined;

  const effectivePlacement = (): TooltipPosition => {
    if (!flipped()) return placement;
    if (placement.startsWith("top")) return placement.replace("top", "bottom") as TooltipPosition;
    if (placement.startsWith("bottom")) return placement.replace("bottom", "top") as TooltipPosition;
    return placement;
  };

  createEffect(() => {
    if (!open()) {
      placed = false;
      setFlipped(false);
      setShiftX(0);
      return;
    }
    // Measure after the floating span exists (same tick as the open render).
    queueMicrotask(() => {
      if (placed || !tipEl || !wrapEl) return;
      placed = true;
      const w = wrapEl.getBoundingClientRect();
      const t = tipEl.getBoundingClientRect();
      const gap = 8;
      const roomAbove = w.top;
      const roomBelow = window.innerHeight - w.bottom;
      if (placement.startsWith("top") && roomAbove < t.height + gap && roomBelow >= t.height + gap) {
        setFlipped(true);
      } else if (placement.startsWith("bottom") && roomBelow < t.height + gap && roomAbove >= t.height + gap) {
        setFlipped(true);
      }
      // A wide tooltip centred on a trigger near an edge pokes off-screen.
      const pad = 8;
      if (t.left < pad) setShiftX(pad - t.left);
      else if (t.right > window.innerWidth - pad) setShiftX(window.innerWidth - pad - t.right);
    });
  });

  if (known.disabled) return <>{known.children}</>;

  // A string label is the tooltip's accessible description. Surface it on the
  // wrapper so it stays queryable without hovering — the floating copy only
  // exists while open. A child that already carries its own accessible name
  // keeps it, so the name is never announced twice.
  const childEl = known.children as any;
  const childHasName =
    childEl != null &&
    typeof childEl === "object" &&
    "props" in childEl &&
    (childEl.props as { "aria-label"?: string; "aria-labelledby"?: string })["aria-label"] != null;
  const ariaLabel =
    typeof known.label === "string" && !childHasName ? known.label : undefined;

  const arrowStyle = (): ArrowPos => {
    const p = effectivePlacement();
    const pos: ArrowPos = { ...ARROW_POS[p] };
    const s = ARROW_SIDE[p];
    if (s && known.color) {
      const prop =
        s === "t"
          ? "borderTopColor"
          : s === "r"
            ? "borderRightColor"
            : s === "b"
              ? "borderBottomColor"
              : "borderLeftColor";
      (pos as Record<string, string>)[prop] = known.color;
    }
    return pos;
  };

  return (
    <span
      ref={(el) => {
        wrapEl = el;
      }}
      id={known.id}
      data-testid={known["data-testid"] ? `${known["data-testid"]}-wrapper` : undefined}
      aria-label={ariaLabel}
      className={cn("inline-flex relative", known.className)}
      style={known.style}
      onMouseEnter={(e) => {
        known.onMouseEnter?.(e);
        show();
      }}
      onMouseLeave={(e) => {
        known.onMouseLeave?.(e);
        hide();
      }}
      {...(rest as Record<string, unknown>)}
    >
      {known.children}
      {open() && known.label && (
        <span
          ref={(el) => {
            tipEl = el;
          }}
          data-testid={known["data-testid"]}
          className={cn(
            "absolute z-50",
            PLACEMENT[effectivePlacement()],
            "bg-fin-surface border border-fin-border text-fin-text rounded-sm text-xs px-2 py-1",
            known.color ? "text-white" : undefined,
            known.multiline ? "max-w-[220px] whitespace-normal" : "whitespace-nowrap",
          )}
          style={{ "background-color": known.color ?? undefined, "margin-left": `${shiftX()}px` }}
        >
          {known.label}
          {known.withArrow && (
            <span
              className="absolute w-0 h-0 border-[5px] border-transparent"
              style={{
                [`border${ARROW_SIDE[effectivePlacement()] === "t" ? "Top" : ARROW_SIDE[effectivePlacement()] === "r" ? "Right" : ARROW_SIDE[effectivePlacement()] === "b" ? "Bottom" : "Left"}Color`]:
                  known.color ?? palette.BORDER,
                ...arrowStyle(),
              }}
            />
          )}
        </span>
      )}
    </span>
  );
}

// Preserve static members for compatibility (no-ops / wrappers)
(Tooltip as any).Group = ({ children }: { children?: any }) => <>{children}</>;
(Tooltip as any).Floating = Tooltip;

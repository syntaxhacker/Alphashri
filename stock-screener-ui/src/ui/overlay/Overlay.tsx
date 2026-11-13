import { splitProps } from "solid-js";
import { cn } from "../cn";
import type { UIOverlayProps } from "../types";

// Palette-derived translucent black backdrop.
import * as palette from "../palette";
import { alpha } from "../alpha";

type OverlayProps = UIOverlayProps;

const DEFAULT_BG = alpha(palette.SCALE_DARK[9], 0.5);

export function Overlay(props: OverlayProps) {
  // `dataTestid` is accepted for compatibility but is not part of UIOverlayProps.
  const [local, rest] = splitProps(props as OverlayProps & { dataTestid?: string }, [
    "color",
    "opacity",
    "blur",
    "zIndex",
    "fixed",
    "center",
    "children",
    "className",
    "style",
    "id",
    "dataTestid",
    "onClick",
    "onMouseEnter",
    "onMouseLeave",
  ]);

  return (
    <div
      id={local.id}
      data-testid={local.dataTestid}
      className={cn("inset-0", local.className)}
      style={{
        position: (local.fixed ?? true) ? "fixed" : "absolute",
        inset: 0,
        "z-index": local.zIndex ?? undefined,
        "background-color": local.color ?? DEFAULT_BG,
        opacity: local.opacity != null ? local.opacity : undefined,
        backdropFilter:
          local.blur != null ? `blur(${typeof local.blur === "number" ? `${local.blur}px` : local.blur})` : undefined,
        display: local.center ? "flex" : undefined,
        "align-items": local.center ? "center" : undefined,
        "justify-content": local.center ? "center" : undefined,
        ...local.style,
      }}
      onClick={local.onClick}
      onMouseEnter={local.onMouseEnter}
      onMouseLeave={local.onMouseLeave}
      {...(rest as Record<string, unknown>)}
    >
      {local.children ? (
        <div
          style={{
            display: local.center ? "flex" : "block",
            ...(local.center ? { "align-items": "center", "justify-content": "center" } : {}),
          }}
        >
          {local.children}
        </div>
      ) : null}
    </div>
  );
}

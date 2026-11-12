import { cn } from "../cn";
import type { UIOverlayProps } from "../types";

// Palette-derived translucent black backdrop.
import * as palette from "../palette";
import { alpha } from "../alpha";

type OverlayProps = UIOverlayProps;

const DEFAULT_BG = alpha(palette.SCALE_DARK[9], 0.5);

export function Overlay({
  color,
  opacity,
  blur,
  zIndex,
  fixed = true,
  center,
  children,
  className,
  style,
  id,
  dataTestid: testId,
  onClick,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: OverlayProps) {
  const backdropFilter =
    blur != null ? `blur(${typeof blur === "number" ? `${blur}px` : blur})` : undefined;

  return (
    <div
      id={id}
      data-testid={testId}
      className={cn("inset-0", className)}
      style={{
        position: fixed ? "fixed" : "absolute",
        inset: 0,
        zIndex: zIndex ?? undefined,
        backgroundColor: color ?? DEFAULT_BG,
        opacity: opacity != null ? opacity : undefined,
        backdropFilter,
        display: center ? "flex" : undefined,
        alignItems: center ? "center" : undefined,
        justifyContent: center ? "center" : undefined,
        ...style,
      }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      {...(rest as Record<string, unknown>)}
    >
      {children ? (
        <div
          style={{
            display: center ? "flex" : "block",
            ...(center ? { alignItems: "center", justifyContent: "center" } : {}),
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

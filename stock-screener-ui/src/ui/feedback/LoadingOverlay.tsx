import { cn } from "../cn";
import * as palette from "../palette";
import { Loader } from "./Loader";
import type { UILoadingOverlayProps } from "../types";

function resolveColor(color: string | undefined): string {
  if (!color) return withAlpha(palette.MARKER_BORDER, 0.6);
  if (color.startsWith("#") || color.startsWith("rgb") || color.startsWith("hsl")) return color;
  const m: Record<string, string> = {
    primary: palette.PRIMARY,
    success: palette.POSITIVE_COLOR,
    error: palette.NEGATIVE_COLOR,
    danger: palette.NEGATIVE_COLOR,
    warning: palette.WARNING,
    info: palette.INFO,
    secondary: palette.TEXT_MUTED,
  };
  return m[color] ?? withAlpha(palette.MARKER_BORDER, 0.6);
}

function withAlpha(hex: string, alpha: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${alpha})`;
}

export function LoadingOverlay({
  visible,
  loaderProps,
  overlayProps,
  zIndex,
  className,
  style,
  "data-testid": testId,
  id,
  children,
  ...rest
}: UILoadingOverlayProps) {
  if (!visible) return null;

  const blur =
    overlayProps?.blur != null
      ? `blur(${typeof overlayProps.blur === "number" ? `${overlayProps.blur}px` : overlayProps.blur})`
      : undefined;

  return (
    <div
      data-testid={testId}
      id={id}
      className={cn("inset-0 z-10 flex items-center justify-center", overlayProps?.fixed ? "fixed" : "absolute", className)}
      style={{
        zIndex,
        backgroundColor: resolveColor(overlayProps?.color),
        opacity: overlayProps?.opacity,
        backdropFilter: blur,
        borderRadius: "inherit",
        ...style,
      }}
      {...rest}
    >
      <div className="flex items-center justify-center w-full h-full">
        <Loader {...loaderProps} />
      </div>
      {children}
    </div>
  );
}

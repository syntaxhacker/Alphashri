import { Show, splitProps } from "solid-js";
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

export function LoadingOverlay(props: UILoadingOverlayProps) {
  const [known, rest] = splitProps(props, [
    "visible",
    "loaderProps",
    "overlayProps",
    "zIndex",
    "className",
    "style",
    "data-testid",
    "id",
    "children",
  ]);

  return (
    <Show when={known.visible}>
      <div
        data-testid={known["data-testid"]}
        id={known.id}
        className={cn("inset-0 z-10 flex items-center justify-center", known.overlayProps?.fixed ? "fixed" : "absolute", known.className)}
        style={{
          zIndex: known.zIndex,
          backgroundColor: resolveColor(known.overlayProps?.color),
          opacity: known.overlayProps?.opacity,
          backdropFilter:
            known.overlayProps?.blur != null
              ? `blur(${typeof known.overlayProps.blur === "number" ? `${known.overlayProps.blur}px` : known.overlayProps.blur})`
              : undefined,
          borderRadius: "inherit",
          ...known.style,
        }}
        {...rest}
      >
        <div className="flex items-center justify-center w-full h-full">
          <Loader {...known.loaderProps} />
        </div>
        {known.children}
      </div>
    </Show>
  );
}

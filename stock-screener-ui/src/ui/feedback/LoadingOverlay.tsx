import { Show, splitProps } from "solid-js";
import { cn } from "../cn";
import * as palette from "../palette";
import { Loader } from "./Loader";
import type { UILoadingOverlayProps } from "../types";

function resolveColor(color: string | undefined): string {
  if (!color) return palette.alpha(palette.SURFACE, 0.72);
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
  return m[color] ?? palette.alpha(palette.SURFACE, 0.72);
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
          "z-index": known.zIndex ?? known.overlayProps?.zIndex,
          "background-color": resolveColor(known.overlayProps?.color),
          opacity: known.overlayProps?.opacity,
          "backdrop-filter":
            known.overlayProps?.blur != null
              ? `blur(${typeof known.overlayProps.blur === "number" ? `${known.overlayProps.blur}px` : known.overlayProps.blur})`
              : undefined,
          "border-radius": "inherit",
          "box-sizing": "border-box",
          ...known.style,
        }}
        {...rest}
        aria-busy="true"
      >
        <div
          className="flex items-center justify-center w-full h-full"
          style={{ "min-width": 0, "min-height": 0, padding: "16px" }}
        >
          <Loader {...known.loaderProps} />
        </div>
        {known.children}
      </div>
    </Show>
  );
}

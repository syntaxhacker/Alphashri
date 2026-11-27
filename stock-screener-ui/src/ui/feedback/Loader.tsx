import { For, Match, Switch, splitProps } from "solid-js";
import { cn } from "../cn";
import * as palette from "../palette";
import type { UILoaderProps } from "../types";

const SIZE_PX: Record<string, string> = { xs: "16px", sm: "20px", md: "28px", lg: "36px", xl: "44px" };
const COLOR_MAIN: Record<string, string> = {
  primary: palette.PRIMARY,
  success: palette.POSITIVE_COLOR,
  error: palette.NEGATIVE_COLOR,
  danger: palette.NEGATIVE_COLOR,
  warning: palette.WARNING,
  info: palette.INFO,
  secondary: palette.TEXT_MUTED,
  default: palette.TEXT_MUTED,
};

const SPIN = "fin-loader-spin 0.85s linear infinite";
const FADE = "fin-loader-fade 0.9s ease-in-out infinite";
// Negative delays put the three marks out of phase from the first frame; no
// timers, no layout reads, and no frame-driven JavaScript.
const phase = (index: number) => `${(index * 0.15 - 0.45).toFixed(2)}s`;

function resolveSize(size: UILoaderProps["size"]): string | undefined {
  if (size == null) return undefined;
  if (typeof size === "number") return `${size}px`;
  if (typeof size === "string" && !isNaN(Number(size))) return `${Number(size)}px`;
  return SIZE_PX[size] ?? undefined;
}

function resolveColor(color: UILoaderProps["color"]): string {
  if (!color) return palette.PRIMARY;
  if (color.startsWith("#") || color.startsWith("rgb") || color.startsWith("hsl")) return color;
  return COLOR_MAIN[color] ?? palette.PRIMARY;
}

function accessibleName(props: UILoaderProps): string {
  const raw = (props as unknown as Record<string, unknown>)["aria-label"];
  return typeof raw === "string" && raw.trim() ? raw : "Loading";
}

export function Loader(props: UILoaderProps) {
  const [known, _rest] = splitProps(props, ["className", "style", "data-testid", "id", "size", "color", "type"]);

  const dim = resolveSize(known.size) ?? "28px";
  const col = resolveColor(known.color);

  return (
    <div
      role="progressbar"
      aria-label={accessibleName(props)}
      aria-busy="true"
      data-testid={known["data-testid"]}
      id={known.id}
      className={cn("inline-block shrink-0", known.className)}
      style={{
        width: dim,
        height: dim,
        color: col,
        display: "inline-flex",
        "align-items": "center",
        "justify-content": "center",
        ...known.style,
      }}
    >
      <Switch fallback={(
        <svg
          data-fin-motion="loader"
          data-loader-part="oval"
          className="shrink-0"
          style={{ width: "100%", height: "100%", animation: SPIN }}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.18" />
          <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="14 43" />
        </svg>
      )}>
        <Match when={known.type === "bars"}>
          <div className="flex w-full h-full items-end justify-center" style={{ gap: "12%" }}>
            <For each={[0.6, 1.0, 0.75]}>{(fill, i) => (
              <div
                data-fin-motion="loader"
                data-loader-part="bar"
                className="bg-current rounded-sm shrink-0"
                style={{
                  width: "18%",
                  height: `${Math.round(fill * 100)}%`,
                  animation: FADE,
                  "animation-delay": phase(i()),
                }}
              />
            )}</For>
          </div>
        </Match>
        <Match when={known.type === "dots"}>
          <div className="flex w-full h-full items-center justify-center" style={{ gap: "10%" }}>
            <For each={[0, 1, 2]}>{(_, i) => (
              <div
                data-fin-motion="loader"
                data-loader-part="dot"
                className="bg-current rounded-full shrink-0"
                style={{
                  width: "22%",
                  height: "22%",
                  animation: FADE,
                  "animation-delay": phase(i()),
                }}
              />
            )}</For>
          </div>
        </Match>
      </Switch>
    </div>
  );
}

import { For, Show, splitProps } from "solid-js";
import { cn } from "../cn";
import * as palette from "../palette";
import type { JSX } from "solid-js";
import type { UIBaseProps, UIColor } from "../types";

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

function resolveColor(color: UIColor | undefined): string {
  if (!color) return palette.PRIMARY;
  if (color.startsWith("#") || color.startsWith("rgb") || color.startsWith("hsl")) return color;
  return COLOR_MAIN[color] ?? palette.PRIMARY;
}

export interface UIRingProgressProps extends UIBaseProps {
  value: number;
  size?: number;
  thickness?: number;
  roundCaps?: boolean;
  color?: UIColor;
  label?: JSX.Element;
  sections?: { value: number; color: UIColor; tooltip?: string }[];
}

export function RingProgress(props: UIRingProgressProps) {
  const [known, _rest] = splitProps(props, [
    "sections",
    "color",
    "value",
    "label",
    "size",
    "thickness",
    "roundCaps",
    "className",
    "style",
    "data-testid",
    "id",
  ]);

  const effSections = known.sections ?? [{ value: known.value, color: (known.color as string) ?? "primary" }];
  const size = known.size ?? 80;
  const thickness = known.thickness ?? 8;
  const cx = size / 2;
  const r = Math.max(1, cx - thickness / 2);
  const circumference = 2 * Math.PI * r;
  const trackColor = palette.TEXT_MUTED; // grey[200]
  const strokeCap = known.roundCaps ? "round" : "butt";

  // Build arcs for each section, drawn clockwise from the top (12 o'clock).
  let acc = 0;
  const arcs: { col: string; startLen: number; arcLen: number }[] = [];
  for (const section of effSections) {
    const start = acc;
    const end = Math.min(100, acc + section.value);
    const startLen = (start / 100) * circumference;
    const arcLen = Math.max(1, ((end - start) / 100) * circumference);
    arcs.push({ col: resolveColor(section.color as string), startLen, arcLen });
    acc = end;
  }

  return (
    <div
      data-testid={known["data-testid"]}
      id={known.id}
      className={cn("relative inline-flex items-center justify-center shrink-0", known.className)}
      style={{ width: size, height: size, ...known.style }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden="true">
        <circle cx={cx} cy={cx} r={r} stroke={trackColor} stroke-width={thickness} fill="none" strokeLinecap={strokeCap} />
        <For each={arcs}>{({ col, startLen, arcLen }) => (
          <circle
            cx={cx}
            cy={cx}
            r={r}
            stroke={col}
            stroke-width={thickness}
            fill="none"
            strokeLinecap={strokeCap}
            strokeDasharray={`${arcLen} ${circumference}`}
            strokeDashoffset={startLen}
            transform={`rotate(-90 ${cx} ${cx})`}
          />
        )}</For>
      </svg>
      <Show when={known.label != null}>
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none select-none"
          style={{ "font-size": Math.max(10, size * 0.25), "font-weight": 600, color: palette.TEXT }}
        >
          {known.label}
        </div>
      </Show>
    </div>
  );
}

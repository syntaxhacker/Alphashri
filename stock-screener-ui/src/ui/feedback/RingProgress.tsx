import { cn } from "../cn";
import * as palette from "../palette";
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
  label?: React.ReactNode;
  sections?: { value: number; color: UIColor; tooltip?: string }[];
}

export function RingProgress({
  sections,
  color,
  value,
  label,
  size = 80,
  thickness = 8,
  roundCaps,
  className,
  style,
  "data-testid": testId,
  id,
}: UIRingProgressProps) {
  const effSections = sections ?? [{ value, color: (color as string) ?? "primary" }];
  const cx = size / 2;
  const r = Math.max(1, cx - thickness / 2);
  const circumference = 2 * Math.PI * r;
  const trackColor = palette.TEXT_MUTED; // grey[200]
  const strokeCap = roundCaps ? "round" : "butt";

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
      data-testid={testId}
      id={id}
      className={cn("relative inline-flex items-center justify-center shrink-0", className)}
      style={{ width: size, height: size, ...style }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden="true">
        <circle cx={cx} cy={cx} r={r} stroke={trackColor} strokeWidth={thickness} fill="none" strokeLinecap={strokeCap} />
        {arcs.map(({ col, startLen, arcLen }, i) => (
          <circle
            key={i}
            cx={cx}
            cy={cx}
            r={r}
            stroke={col}
            strokeWidth={thickness}
            fill="none"
            strokeLinecap={strokeCap}
            strokeDasharray={`${arcLen} ${circumference}`}
            strokeDashoffset={startLen}
            transform={`rotate(-90 ${cx} ${cx})`}
          />
        ))}
      </svg>
      {label != null && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none" style={{ fontSize: Math.max(10, size * 0.25), fontWeight: 600, color: palette.TEXT }}>
          {label}
        </div>
      )}
    </div>
  );
}

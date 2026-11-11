import { cn } from "../cn";
import * as palette from "../palette";
import type { UIProgressProps } from "../types";

const SIZE_PX: Record<string, string> = { xs: "4px", sm: "8px", md: "12px", lg: "16px", xl: "20px" };
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

function resolveSize(size: UIProgressProps["size"]): string | undefined {
  if (size == null) return undefined;
  if (typeof size === "number") return `${size}px`;
  if (typeof size === "string") return SIZE_PX[size] ?? size;
  return undefined;
}

function resolveColor(color: UIProgressProps["color"]): string {
  if (!color) return palette.PRIMARY;
  if (color.startsWith("#") || color.startsWith("rgb") || color.startsWith("hsl")) return color;
  return COLOR_MAIN[color] ?? palette.PRIMARY;
}

function radiusValue(radius: UIProgressProps["radius"] | undefined): string | undefined {
  if (radius == null) return undefined;
  if (typeof radius === "number") return `${radius}px`;
  const m: Record<string, string> = { xs: "4px", sm: "6px", md: "8px", lg: "12px", xl: "16px" };
  return m[radius] ?? undefined;
}

function hexRgb(hex: string): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
  return `${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}`;
}

const MARKER_RGB = hexRgb(palette.MARKER_BORDER);
const STRIPE = `repeating-linear-gradient(45deg, rgba(${MARKER_RGB}, 0.15) 0 8px, transparent 8px 16px)`;

export function Progress({
  value,
  color,
  size,
  radius,
  striped,
  animated,
  label,
  sections,
  transitionDuration,
  className,
  style,
  "data-testid": testId,
  id,
  ...rest
}: UIProgressProps) {
  const h = resolveSize(size) ?? "8px";
  const br = radiusValue(radius);
  const col = resolveColor(color);
  const v = Math.max(0, Math.min(100, value ?? 0));
  const transition = transitionDuration != null ? `width ${transitionDuration}ms` : undefined;

  const barBase: React.CSSProperties = {
    height: h,
    borderRadius: br,
    backgroundColor: col,
    ...(striped ? { backgroundImage: STRIPE } : {}),
    ...(animated && striped ? { backgroundSize: "16px 16px" } : {}),
    ...(transition ? { transition } : {}),
  };

  if (sections && sections.length > 0) {
    return (
      <div
        data-testid={testId}
        id={id}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        className={cn("flex w-full shrink-0 overflow-hidden", className)}
        style={{ height: h, borderRadius: br, backgroundColor: palette.BORDER, ...style }}
        {...rest}
      >
        {sections.map((section, i) => {
          const scol = resolveColor(section.color);
          const width = Math.max(0, Math.min(100, section.value));
          return (
            <div
              key={i}
              className="shrink-0 flex items-center justify-center"
              style={{
                width: `${width}%`,
                height: "100%",
                backgroundColor: scol,
                borderRadius: 0,
                ...(transition ? { transition } : {}),
                ...(striped ? { backgroundImage: STRIPE } : {}),
              }}
            >
              {(label || section.label) && (
                <span className="text-[10px] font-semibold text-fin-text pointer-events-none select-none">
                  {section.label ?? label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      data-testid={testId}
      id={id}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      className={cn("relative w-full shrink-0", className)}
      style={style}
      {...rest}
    >
      <div
        className="w-full shrink-0"
        style={{ height: h, borderRadius: br, backgroundColor: palette.BORDER, ...(striped ? { backgroundImage: STRIPE } : {}) }}
      />
      <div className="shrink-0" style={barBase} />
      {label && (
        <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-fin-text pointer-events-none select-none">
          {label}
        </span>
      )}
    </div>
  );
}

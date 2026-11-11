import { cn } from "../cn";
import type { UIAvatarProps } from "../types";

function mapSize(size: UIAvatarProps["size"]): { w: string; h: string; fontSize: string } {
  if (size == null) return { w: "40px", h: "40px", fontSize: "16px" };
  if (typeof size === "number") return { w: `${size}px`, h: `${size}px`, fontSize: `${size * 0.4}px` };
  if (typeof size === "string" && !isNaN(Number(size))) {
    const n = Number(size);
    return { w: `${n}px`, h: `${n}px`, fontSize: `${n * 0.4}px` };
  }
  const map: Record<string, number> = { xs: 24, sm: 32, md: 40, lg: 48, xl: 56 };
  const px = map[size as string];
  if (px) return { w: `${px}px`, h: `${px}px`, fontSize: `${px * 0.4}px` };
  return { w: "40px", h: "40px", fontSize: "16px" };
}

function initials(text: string): string {
  return text
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("") || "?";
}

const BG_BY_COLOR: Record<string, string> = {
  primary: "bg-fin-primary text-fin-bg",
  secondary: "bg-fin-text-muted text-fin-bg",
  success: "bg-fin-positive text-fin-bg",
  error: "bg-fin-negative text-fin-bg",
  warning: "bg-fin-warning text-fin-bg",
  info: "bg-fin-info text-fin-bg",
  danger: "bg-fin-negative text-fin-bg",
};

function radiusClass(radius: UIAvatarProps["radius"]): string {
  if (radius == null) return "";
  if (typeof radius === "number") return `rounded-[${radius}px]`;
  if (radius === "xs") return "rounded-[4px]";
  if (radius === "xl") return "rounded-[16px]";
  return "rounded-sm";
}

export function Avatar({ src, alt, color, radius, size, children, className, style, "data-testid": testId, id, ...rest }: UIAvatarProps) {
  const { w, h, fontSize } = mapSize(size);
  const hasSrc = Boolean(src);
  const colorCls = color ? (BG_BY_COLOR[String(color)] ?? "bg-fin-surface text-fin-text") : "bg-fin-surface text-fin-text";
  const display = hasSrc ? undefined : children ?? (alt ? initials(alt) : "?");

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center overflow-hidden border border-fin-border shrink-0",
        colorCls,
        radiusClass(radius),
        className,
      )}
      style={{ width: w, height: h, fontSize, ...style }}
      id={id}
      data-testid={testId}
      {...(rest as Record<string, unknown>)}
    >
      {hasSrc ? (
        <img src={src} alt={alt ?? ""} className="w-full h-full object-cover" />
      ) : (
        <span className="text-fin-text font-medium leading-none">{display}</span>
      )}
    </div>
  );
}

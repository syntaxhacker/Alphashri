import { splitProps } from "solid-js";
import { cn } from "../cn";
import { TYPE_SCALE, typeSize } from "../typography";
import type { UIAvatarProps } from "../types";

const SCALE_STEPS = Object.values(TYPE_SCALE).map((s) => s.size);

/**
 * Initials are a decorative monogram, not body copy: the ratio to the avatar
 * diameter is kept, but the result is snapped to the shared ladder and floored
 * at micro. Even the smallest avatar (24px) therefore renders at >= 12px.
 */
function snapTypeSize(px: number): number {
  const nearest = SCALE_STEPS.reduce(
    (best, step) => (Math.abs(step - px) <= Math.abs(best - px) ? step : best),
    SCALE_STEPS[0],
  );
  return Math.max(typeSize("micro"), nearest);
}

function mapSize(size: UIAvatarProps["size"]): { width: string; height: string; "font-size": string } {
  if (size == null) return { width: "40px", height: "40px", "font-size": `${typeSize("title")}px` };
  if (typeof size === "number") return { width: `${size}px`, height: `${size}px`, "font-size": `${snapTypeSize(size * 0.4)}px` };
  if (typeof size === "string" && !isNaN(Number(size))) {
    const n = Number(size);
    return { width: `${n}px`, height: `${n}px`, "font-size": `${snapTypeSize(n * 0.4)}px` };
  }
  const map: Record<string, number> = { xs: 24, sm: 32, md: 40, lg: 48, xl: 56 };
  const px = map[size as string];
  if (px) return { width: `${px}px`, height: `${px}px`, "font-size": `${snapTypeSize(px * 0.4)}px` };
  return { width: "40px", height: "40px", "font-size": `${typeSize("title")}px` };
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

export function Avatar(props: UIAvatarProps) {
  const [known, _rest] = splitProps(props, [
    "src",
    "alt",
    "color",
    "radius",
    "size",
    "children",
    "className",
    "style",
    "data-testid",
    "id",
  ]);

  const dims = mapSize(known.size);
  const hasSrc = Boolean(known.src);
  const colorCls = known.color ? (BG_BY_COLOR[String(known.color)] ?? "bg-fin-surface text-fin-text") : "bg-fin-surface text-fin-text";
  const display = hasSrc ? undefined : known.children ?? (known.alt ? initials(known.alt) : "?");

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center overflow-hidden border border-fin-border shrink-0",
        colorCls,
        radiusClass(known.radius),
        known.className,
      )}
      style={{ ...dims, ...known.style }}
      id={known.id}
      data-testid={known["data-testid"]}
    >
      {hasSrc ? (
        <img src={known.src ?? undefined} alt={known.alt ?? ""} className="w-full h-full object-cover" />
      ) : (
        <span className="font-medium leading-none">{display}</span>
      )}
    </div>
  );
}

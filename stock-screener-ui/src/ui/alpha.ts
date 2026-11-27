const clamp = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Local alpha helper. Accepts #rgb/#rrggbb and
 * rgb()/rgba() inputs; returns an rgba() string.
 */
export function alpha(color: string, opacity: number): string {
  const value = String(color || "").trim();
  const amount = clamp(Number.isFinite(opacity) ? opacity : 1);

  if (value.startsWith("#")) {
    const hex = value.slice(1);
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    if (/^[0-9a-f]{6}$/i.test(full)) {
      const r = Number.parseInt(full.slice(0, 2), 16);
      const g = Number.parseInt(full.slice(2, 4), 16);
      const b = Number.parseInt(full.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${amount})`;
    }
  }

  const match = value.match(/^rgba?\(([^)]+)\)$/i);
  if (match) {
    const parts = match[1].split(",").map((p) => p.trim());
    if (parts.length >= 3) {
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${amount})`;
    }
  }

  return value;
}

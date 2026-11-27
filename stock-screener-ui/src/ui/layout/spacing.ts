/** Named 8pt-ramp steps; unknown strings pass through so a caller can supply raw CSS. */
const SPACING: Record<string, string> = { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" };

export const sp = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  if (typeof v === "number") return `${v}px`;
  return (SPACING[v as string] ?? v) as string;
};

export const toSz = (v: unknown): string | undefined =>
  typeof v === "number" ? `${v}px` : (v as string | undefined);

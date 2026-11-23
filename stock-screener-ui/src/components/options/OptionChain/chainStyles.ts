import { fontWeights } from "../../../config/theme";
import { typeSize } from "@/ui";
import * as palette from "@/ui/palette";

export type ThemeType = any;

/**
 * Below this width the eleven numeric columns stop being scannable and the
 * chain scrolls sideways as one unit (header, subheader and rows together).
 */
export const CHAIN_TABLE_MIN_WIDTH = 980;

/** Mirrors Tailwind's `sm` breakpoint and the `sm:hidden` sideways cue. */
export const CHAIN_COMPACT_QUERY = "(max-width: 639px)";

export interface ChainLayout {
  /** Viewport is below the `sm` breakpoint. */
  narrow?: boolean;
  /** The reduced core-column view is active (only possible when narrow). */
  compact?: boolean;
}

function resolveFontSize(_theme: any, key: "sm" | "md"): number {
  return key === "sm" ? typeSize("micro") : typeSize("label");
}

export const getStyles = (_theme: ThemeType, _isDark: boolean, layout: ChainLayout = {}) => {
  const compact = !!layout.compact;
  const narrow = !!layout.narrow;
  // The wide grid pins strike at the inner grid's centre. A 390px viewport
  // cannot see that point (the inner is 980px wide), so narrow views pin it to
  // the leading edge; the compact grid has no horizontal scroll to pin against.
  const strikeLeft = compact ? "0px" : narrow ? "8px" : "calc(50% - 40px)";
  const numericColumns = compact
    ? "1fr 1fr 80px 1fr 1fr"
    : "repeat(5, 1fr) 80px repeat(5, 1fr)";
  const gridGap = compact ? "4px" : "8px";
  const gridPadding = compact ? "6px" : "8px";

  return {
    container: {
      display: "flex",
      flexDirection: "column" as const,
      // The desktop chain owns a fixed scrollport. On a phone let it hug its
      // rows instead of reserving `100vh - 300px` for columns that no longer
      // exist in the compact view.
      height: compact ? "auto" : "calc(100vh - 300px)",
      minHeight: compact ? 0 : 400,
      width: "100%",
      overflow: "hidden" as const,
      borderRadius: 1,
      backgroundColor: palette.SURFACE,
    },
    header: {
      display: "grid",
      gridTemplateColumns: "1fr 80px 1fr",
      backgroundColor: palette.SURFACE,
      position: "sticky" as const,
      top: 0,
      zIndex: 10,
      gap: gridGap,
      padding: gridPadding,
    },
    headerCell: {
      padding: "10px 8px",
      textAlign: "center" as const,
      fontWeight: fontWeights.bold,
      fontSize: resolveFontSize(null as any, "md"),
      letterSpacing: "0.08em",
      textTransform: "uppercase" as const,
      color: palette.TEXT,
    },
    subHeader: {
      display: "grid",
      gridTemplateColumns: numericColumns,
      backgroundColor: palette.SURFACE,
      position: "sticky" as const,
      top: compact ? 34 : 40,
      zIndex: 9,
      gap: gridGap,
      padding: gridPadding,
    },
    subHeaderCell: {
      padding: "5px 2px",
      textAlign: "center" as const,
      fontSize: typeSize("micro"),
      color: palette.TEXT_MUTED,
      fontWeight: fontWeights.semibold,
      textTransform: "uppercase" as const,
      letterSpacing: "0.04em",
      fontVariantNumeric: "tabular-nums" as const,
    },
    row: {
      display: "grid",
      gridTemplateColumns: numericColumns,
      // Same gap/padding as the header and subheader so all three grids share
      // one column geometry — the strike column must line up end to end.
      gap: gridGap,
      padding: gridPadding,
      transition: "background 0.18s ease",
      position: "relative" as const,
      backgroundColor: palette.BG,
    },
    cell: {
      padding: compact ? "4px 2px" : "6px 4px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: resolveFontSize(null as any, "sm"),
      cursor: "pointer",
      minHeight: compact ? 36 : 42,
      width: "100%",
      position: "relative" as const,
      overflow: "hidden" as const,
      fontVariantNumeric: "tabular-nums" as const,
    },
    strikeCell: {
      padding: "4px 8px",
      display: "flex",
      flexDirection: "column" as const,
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center" as const,
      backgroundColor: palette.SURFACE,
      position: "sticky" as const,
      left: strikeLeft,
      zIndex: 2,
      fontVariantNumeric: "tabular-nums" as const,
    },
    atmHighlight: {
      backgroundColor: palette.alpha(palette.INDICATOR_BLUE_A, 0.14),
      color: palette.WARNING,
    },
    // Distinct ATM row wash applied on top of the side gradient so the
    // at-the-money strike stays visually anchored after auto-scroll.
    atmRow: {
      outline: "1px solid",
      outlineColor: palette.WARNING,
    },
    // Subtle zebra tint for non-ATM rows (kept faint so heatmaps stay legible).
    zebraRow: {
      backgroundColor: palette.alpha(palette.TEXT_ON_ACCENT, 0.04),
    },
    // Compact ATM window toggle bar pinned above the sticky table header.
    windowBar: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      padding: compact ? "4px 8px" : "4px 12px",
      flexWrap: "wrap" as const,
    },
  };
};

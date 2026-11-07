import { formatNumberIN } from "@/utils/ui-helpers";
import { memo } from "react";
import Box from "@mui/material/Box";
import * as palette from "@/ui/palette";
import type { BreadthPayload } from "@/api/reportNifty";

/**
 * Five-index breadth in 20px: NIFTY / BANK / MID / SMALL / BROAD with their
 * day %, plus "n/5 up". A narrow rally (index up, smallcaps red) is the fade
 * warning; a broad one (4-5 up) is a real risk-on tape.
 */
function BreadthStripInner({ data }: { data: BreadthPayload | null }) {
  if (!data?.available || data.rows.length === 0) return null;
  const priced = data.rows.filter((r) => r.change_pct != null);
  return (
    <Box
      data-testid="nifty-breadth-strip"
      data-up={data.up}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        height: 20,
        minHeight: 20,
        px: 1,
        border: `1px solid ${palette.TERM_BORDER}`,
        borderRadius: "4px",
        bgcolor: palette.TERM_HEADER,
        width: "100%",
        minWidth: 0,
        flexShrink: 0,
        fontFamily: palette.MONO,
        fontSize: 9,
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <Box component="span" sx={{ color: palette.TEXT_MUTED, fontWeight: 700, letterSpacing: "0.08em", flexShrink: 0 }}>
        BREADTH
      </Box>
      <Box
        component="span"
        data-testid="nifty-breadth-count"
        sx={{ fontWeight: 800, flexShrink: 0, color: data.up >= 3 ? palette.POSITIVE : data.up === 0 ? palette.NEGATIVE : palette.WARNING }}
      >
        {data.up}/{priced.length} up
      </Box>
      {priced.map((r) => {
        const pct = r.change_pct ?? 0;
        const tone = pct > 0 ? palette.POSITIVE : pct < 0 ? palette.NEGATIVE : palette.TEXT_MUTED;
        return (
          <Box
            key={r.label}
            component="span"
            data-testid={`nifty-breadth-${r.label.toLowerCase()}`}
            title={`${r.label}: ${r.last ? formatNumberIN(r.last) ?? "—" : "—"} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`}
            sx={{ display: "inline-flex", alignItems: "center", gap: "3px", flexShrink: 0, color: palette.TEXT_MUTED }}
          >
            {r.label}
            <Box component="b" sx={{ color: tone, fontWeight: 800 }}>
              {pct >= 0 ? "+" : ""}
              {pct.toFixed(2)}%
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

/** Memoised: the parent repaints on the ~1 s spot tick, `data` only on its 60s poll. */
export const BreadthStrip = memo(BreadthStripInner);
BreadthStrip.displayName = "BreadthStrip";

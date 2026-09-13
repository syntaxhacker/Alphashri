// CollapsiblePanel — dense panel for the backtest right rail.
import { Box } from "@/ui";
import * as palette from "@/ui/palette";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import type { BacktestPanelId } from "./useBacktestLayout";

interface CollapsiblePanelProps {
  id: BacktestPanelId;
  title: string;
  badge?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export function CollapsiblePanel({ id, title, badge, open, onToggle, children }: CollapsiblePanelProps) {
  return (
    <Box
      data-testid={`panel-${id}`}
      data-open={open ? "true" : "false"}
      sx={{
        display: "flex",
        flexDirection: "column",
        flex: open ? "1 1 0" : "0 0 auto",
        minHeight: 0,
        minWidth: 0,
        borderTop: `1px solid ${palette.BORDER}`,
        "&:first-of-type": { borderTop: 0 },
      }}
    >
      <Box
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onToggle(); }}
        sx={{
          flex: "0 0 auto",
          height: 28,
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          px: 1,
          cursor: "pointer",
          userSelect: "none",
          bgcolor: palette.SURFACE_ALT,
          "&:hover": { bgcolor: palette.BORDER },
        }}
      >
        <Box sx={{ display: "grid", placeItems: "center", color: palette.TEXT_MUTED }}>
          {open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
        </Box>
        <Box component="span" sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: palette.TEXT, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {title}
        </Box>
        {badge != null && (
          <Box sx={{ minWidth: 18, height: 16, px: 0.5, display: "grid", placeItems: "center", borderRadius: "8px", bgcolor: palette.BORDER, fontSize: 10, fontWeight: 700, color: palette.TEXT, fontVariantNumeric: "tabular-nums" }}>
            {badge}
          </Box>
        )}
      </Box>
      {open && (
        <Box sx={{ flex: "1 1 auto", minHeight: 0, minWidth: 0, overflow: "auto", display: "flex", flexDirection: "column" }}>
          {children}
        </Box>
      )}
    </Box>
  );
}

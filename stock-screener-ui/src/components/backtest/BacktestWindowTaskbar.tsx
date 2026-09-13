// BacktestWindowTaskbar — restore dock for minimized floating windows.
// Minimized windows stay mounted (state preserved) and appear here as chips.
import { Box } from "@/ui";
import * as palette from "@/ui/palette";
import { IconWindowMaximize, IconX } from "@tabler/icons-react";
import type { BacktestWindowId } from "./useBacktestWindows";

export interface TaskbarItem {
  id: BacktestWindowId;
  title: string;
}

export function BacktestWindowTaskbar({
  items,
  onRestore,
  onClose,
}: {
  items: TaskbarItem[];
  onRestore: (id: BacktestWindowId) => void;
  onClose: (id: BacktestWindowId) => void;
}) {
  if (items.length === 0) return null;

  return (
    <Box
      data-testid="window-taskbar"
      sx={{
        position: "absolute",
        left: 8,
        bottom: 8,
        zIndex: 1100,
        display: "flex",
        gap: 0.5,
        pointerEvents: "auto",
      }}
    >
      {items.map((it) => (
        <Box
          key={it.id}
          role="button"
          tabIndex={0}
          aria-label={`Restore ${it.title}`}
          data-testid={`taskbar-${it.id}`}
          onClick={() => onRestore(it.id)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onRestore(it.id); }}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            height: 24,
            px: 1,
            borderRadius: 1,
            bgcolor: palette.SURFACE,
            border: `1px solid ${palette.BORDER}`,
            color: palette.TEXT,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
            boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
            "&:hover": { bgcolor: palette.SURFACE_ALT },
          }}
        >
          <IconWindowMaximize size={11} />
          {it.title}
          <Box
            component="span"
            role="button"
            aria-label={`Close ${it.title}`}
            onClick={(e) => { e.stopPropagation(); onClose(it.id); }}
            sx={{ display: "grid", placeItems: "center", width: 14, height: 14, ml: 0.25, borderRadius: 0.5, color: palette.TEXT_MUTED, "&:hover": { color: palette.NEGATIVE } }}
          >
            <IconX size={10} />
          </Box>
        </Box>
      ))}
    </Box>
  );
}

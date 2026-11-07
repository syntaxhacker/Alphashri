import { useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { IconX } from "@tabler/icons-react";
import * as palette from "@/ui/palette";

export type DeskDockKey = "flow" | "setup" | "alerts" | "market";

export interface DeskDockTab {
  key: DeskDockKey;
  label: string;
  /** Compact live value shown in the closed tab bar. */
  summary: ReactNode;
  content: ReactNode;
  /** Critical count, rendered as a red badge on the tab. */
  badge?: number;
  /** Fixed drawer height for content that needs it (the alert log); omit to
   *  hug the content so a 2-strip MARKET drawer is not 300px of black. */
  height?: number;
}

/**
 * Desk bottom dock — the low-frequency panels live here so the chart, chain
 * and walls own the first screen. The tab bar stays visible; one drawer opens
 * at a time; Alt+1..4 toggles, Esc closes (the Drawer handles it).
 */
export function DeskDock({
  tabs,
  active,
  onActiveChange,
}: {
  tabs: DeskDockTab[];
  active: DeskDockKey | null;
  onActiveChange: (key: DeskDockKey | null) => void;
}) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down("sm"));
  const activeTab = tabs.find((tab) => tab.key === active) ?? null;

  const toggle = useCallback(
    (key: DeskDockKey) => onActiveChange(active === key ? null : key),
    [active, onActiveChange],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const index = Number(event.key) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= tabs.length) return;
      event.preventDefault();
      toggle(tabs[index].key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabs, toggle]);

  return (
    <>
      <Box
        data-testid="desk-dock"
        sx={{
          position: "sticky",
          bottom: 0,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 0.25,
          height: 26,
          minHeight: 26,
          px: 0.5,
          bgcolor: palette.TERM_HEADER,
          borderTop: `1px solid ${palette.TERM_BORDER}`,
          overflowX: "auto",
          overflowY: "hidden",
        }}
      >
        {tabs.map((tab) => {
          const selected = active === tab.key;
          return (
            <Button
              key={tab.key}
              data-testid={`desk-dock-${tab.key}`}
              size="sm"
              variant={selected ? "filled" : "subtle"}
              aria-pressed={selected}
              onClick={() => toggle(tab.key)}
              sx={{
                height: 20,
                minWidth: 0,
                px: 0.75,
                py: 0,
                gap: 0.5,
                borderRadius: 0.5,
                whiteSpace: "nowrap",
              }}
            >
              <Typography component="span" sx={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 0.5 }}>
                {tab.label}
              </Typography>
              <Typography component="span" sx={{ fontSize: 8, color: palette.TEXT_MUTED }}>
                {tab.summary}
              </Typography>
              {tab.badge && tab.badge > 0 ? (
                <Box
                  component="span"
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 15,
                    height: 14,
                    px: 0.4,
                    borderRadius: 7,
                    bgcolor: palette.NEGATIVE,
                    color: "#fff",
                    fontSize: 7.5,
                    fontWeight: 800,
                    lineHeight: 1,
                  }}
                >
                  {tab.badge}
                </Box>
              ) : null}
            </Button>
          );
        })}
        <Typography
          sx={{ ml: "auto", pr: 0.5, fontSize: 7.5, color: palette.TEXT_MUTED, whiteSpace: "nowrap" }}
        >
          ALT+1..{tabs.length} · ESC
        </Typography>
      </Box>

      <Drawer
        anchor="bottom"
        open={activeTab !== null}
        onClose={() => onActiveChange(null)}
        slotProps={{
          paper: {
            id: "desk-dock-drawer",
            sx: {
              left: { xs: 0, md: "var(--app-nav-width, 0px)" },
              right: 0,
              width: "auto",
              height: mobile ? "100%" : activeTab?.height ?? "auto",
              maxHeight: mobile ? "100%" : "55vh",
              bgcolor: palette.TERM_BG,
              backgroundImage: "none",
              borderTop: `1px solid ${palette.TERM_BORDER}`,
              boxShadow: "0 -8px 24px rgba(0,0,0,0.45)",
            },
          },
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.25,
              height: 24,
              minHeight: 24,
              px: 0.5,
              borderBottom: `1px solid ${palette.TERM_BORDER}`,
              bgcolor: palette.TERM_HEADER,
            }}
          >
            {tabs.map((tab) => (
              <Button
                key={tab.key}
                size="sm"
                variant={active === tab.key ? "filled" : "subtle"}
                onClick={() => onActiveChange(tab.key)}
                sx={{ height: 20, minWidth: 0, px: 0.75, py: 0, fontSize: 8.5, fontWeight: 800, letterSpacing: 0.4 }}
              >
                {tab.label}
              </Button>
            ))}
            <IconButton
              size="small"
              aria-label="Close desk dock"
              onClick={() => onActiveChange(null)}
              sx={{ ml: "auto", p: 0.25, borderRadius: 0.5 }}
            >
              <IconX size={12} />
            </IconButton>
          </Box>
          <Box
            data-testid={active ? `desk-dock-body-${active}` : undefined}
            sx={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              p: 0.5,
              "& [data-compact]": { border: "none !important" },
            }}
          >
            {activeTab?.content}
          </Box>
        </Box>
      </Drawer>
    </>
  );
}

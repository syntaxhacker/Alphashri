// CollapsiblePanel — dense panel for the backtest right rail (MUI elements).
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import ButtonBase from "@mui/material/ButtonBase";
import Divider from "@mui/material/Divider";
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
        borderTop: 1,
        borderColor: "divider",
        "&:first-of-type": { borderTop: 0 },
      }}
    >
      <ButtonBase
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
        sx={{
          width: "100%",
          height: 30,
          px: 1,
          justifyContent: "flex-start",
          bgcolor: open ? "action.selected" : "background.default",
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ width: "100%" }}>
          <Box sx={{ display: "grid", placeItems: "center", color: "text.secondary" }}>
            {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </Box>
          <Typography
            variant="overline"
            sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, flex: 1, textAlign: "left", color: "text.primary", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {title}
          </Typography>
          {badge != null && (
            <Chip
              size="small"
              label={badge}
              sx={{ height: 16, fontSize: 10, fontWeight: 700, bgcolor: "action.hover", "& .MuiChip-label": { px: 0.75 } }}
            />
          )}
        </Stack>
      </ButtonBase>
      <Divider />
      {open && (
        <Box sx={{ flex: "1 1 auto", minHeight: 0, minWidth: 0, overflow: "auto", display: "flex", flexDirection: "column" }}>
          {children}
        </Box>
      )}
    </Box>
  );
}

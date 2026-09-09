import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { IconRefresh, IconTable, IconChartDots, IconSettings } from "@tabler/icons-react";
import * as palette from "@/ui/palette";

const meta: Meta = {
  title: "Temp/Screener Redesign POC",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    backgrounds: { default: "dark" },
    docs: { description: { component: "POC for compact screener redesign — simple MUI black theme (BG #0D1117, SURFACE #161B22, BORDER #30363D, no blue). 8pt grid, FIN 48px header. All temp, not for production." } },
  },
};
export default meta;

// ---- shared mock data ----
const SCREENER_OPTS = [
  { id: "trending", label: "Trending" },
  { id: "52w_high", label: "52W High" },
  { id: "volume_surge", label: "Volume Surge" },
  { id: "breakout", label: "Breakout" },
];
const MOCK_ROWS = Array.from({ length: 8 }, (_, i) => ({
  symbol: ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "SBIN", "BHARTIARTL", "ITC"][i],
  price: (1200 + i * 123).toFixed(2),
  change: (i % 2 ? "+" : "-") + (0.5 + i * 0.3).toFixed(2) + "%",
}));

function MockTable() {
  return (
    <Box sx={{ border: 1, borderColor: palette.BORDER, borderRadius: 1, overflow: "hidden", bgcolor: palette.SURFACE }}>
      <Box sx={{ display: "flex", gap: 0, bgcolor: palette.SURFACE_ALT, px: 1.5, py: 1, borderBottom: 1, borderColor: palette.BORDER }}>
        <Typography variant="caption" sx={{ flex: 1, fontWeight: 600, color: palette.TEXT_MUTED }}>Symbol</Typography>
        <Typography variant="caption" sx={{ width: 90, textAlign: "right", fontWeight: 600, color: palette.TEXT_MUTED }}>Price</Typography>
        <Typography variant="caption" sx={{ width: 80, textAlign: "right", fontWeight: 600, color: palette.TEXT_MUTED }}>Change</Typography>
        <Typography variant="caption" sx={{ width: 70, textAlign: "right", fontWeight: 600, color: palette.TEXT_MUTED }}>Score</Typography>
      </Box>
      {MOCK_ROWS.map((r) => (
        <Box key={r.symbol} sx={{ display: "flex", gap: 0, px: 1.5, py: 1, borderBottom: 1, borderColor: palette.BORDER, "&:last-child": { borderBottom: 0 }, height: 28, alignItems: "center", bgcolor: palette.SURFACE, "&:hover": { bgcolor: palette.SURFACE_ALT } }}>
          <Typography variant="body2" sx={{ flex: 1, fontSize: 12, fontWeight: 600, color: palette.TEXT }}>{r.symbol}</Typography>
          <Typography variant="body2" sx={{ width: 90, textAlign: "right", fontSize: 12, color: palette.TEXT }}>{r.price ? `₹${r.price}` : r.price}</Typography>
          <Typography variant="body2" sx={{ width: 80, textAlign: "right", fontSize: 12, color: r.change.startsWith("+") ? palette.POSITIVE : palette.NEGATIVE, fontWeight: 600 }}>{r.change}</Typography>
          <Typography variant="body2" sx={{ width: 70, textAlign: "right", fontSize: 12, color: palette.TEXT_MUTED }}>{95 - MOCK_ROWS.indexOf(r) * 3}</Typography>
        </Box>
      ))}
    </Box>
  );
}

// ---- Option A : Unified Toolbar (recommended, minimal risk) ----
function OptionA() {
  const [tab, setTab] = useState(0);
  const [screener, setScreener] = useState("trending");
  const [provider, setProvider] = useState("upstox");
  const [mode, setMode] = useState("intraday");
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 2, bgcolor: palette.BG, minHeight: 420 }}>
      <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, fontWeight: 700, letterSpacing: 0.5 }}>OPTION A — Unified 48px Toolbar (Recommended)</Typography>
      {/* single Paper bar — FIN_HEADER_H 48, elevation 0 + 1px divider, radius 8 */}
      <Paper elevation={0} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, px: 2, height: 48, minHeight: 48, maxHeight: 48, border: 1, borderColor: palette.BORDER, borderRadius: 2, overflow: "hidden", flexWrap: "nowrap", bgcolor: palette.SURFACE }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexShrink: 0 }}>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel sx={{ fontSize: 12 }}>Screener</InputLabel>
            <Select size="small" value={screener} label="Screener" onChange={(e) => setScreener(e.target.value)} sx={{ fontSize: 12, height: 32 }}>
              {SCREENER_OPTS.map((o) => <MenuItem key={o.id} value={o.id} sx={{ fontSize: 12 }}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 32, "& .MuiTab-root": { minHeight: 32, fontSize: 12, py: 0, minWidth: 90 } }}>
            <Tab icon={<IconTable size={14} />} iconPosition="start" label="Screener" sx={{ textTransform: "none" }} />
            <Tab icon={<IconChartDots size={14} />} iconPosition="start" label="Correlation" sx={{ textTransform: "none" }} />
            <Tab icon={<IconSettings size={14} />} iconPosition="start" label="Config" sx={{ textTransform: "none" }} />
          </Tabs>
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, px: 1, display: "flex", justifyContent: "center", overflow: "hidden" }}>
          <Typography variant="caption" noWrap sx={{ color: palette.TEXT_MUTED, fontSize: 11 }}>48 stocks • 2s • live</Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0, flexWrap: "nowrap" }}>
          <Tooltip title="Refresh"><IconButton size="small" sx={{ color: palette.TEXT_MUTED, border: 1, borderColor: palette.BORDER }}><IconRefresh size={14} /></IconButton></Tooltip>
          <TextField size="small" defaultValue={60} sx={{ width: 64, "& .MuiOutlinedInput-root": { bgcolor: palette.SURFACE_ALT, "& fieldset": { borderColor: palette.BORDER } }, "& input": { fontSize: 12, p: "6px 8px", color: palette.TEXT } }} label="" placeholder="60s" />
          <FormControl size="small" sx={{ minWidth: 96, "& .MuiOutlinedInput-root": { bgcolor: palette.SURFACE_ALT, "& fieldset": { borderColor: palette.BORDER } }, "& .MuiInputLabel-root": { color: palette.TEXT_MUTED } }}><InputLabel sx={{ fontSize: 11 }}>Provider</InputLabel>
            <Select size="small" value={provider} label="Provider" onChange={(e) => setProvider(e.target.value)} sx={{ fontSize: 12, height: 32, color: palette.TEXT, "& .MuiSvgIcon-root": { color: palette.TEXT_MUTED } }}><MenuItem value="upstox" sx={{ fontSize: 12 }}>Upstox</MenuItem><MenuItem value="indmoney" sx={{ fontSize: 12 }}>IND</MenuItem></Select></FormControl>
          <FormControl size="small" sx={{ minWidth: 96, "& .MuiOutlinedInput-root": { bgcolor: palette.SURFACE_ALT, "& fieldset": { borderColor: palette.BORDER } }, "& .MuiInputLabel-root": { color: palette.TEXT_MUTED } }}><InputLabel sx={{ fontSize: 11 }}>Mode</InputLabel>
            <Select size="small" value={mode} label="Mode" onChange={(e) => setMode(e.target.value)} sx={{ fontSize: 12, height: 32, color: palette.TEXT }}><MenuItem value="intraday" sx={{ fontSize: 12 }}>Intra</MenuItem><MenuItem value="historical" sx={{ fontSize: 12 }}>5D</MenuItem></Select></FormControl>
          <Box sx={{ display: "flex", border: 1, borderColor: palette.BORDER, borderRadius: 1, overflow: "hidden", height: 32 }}>
            <Button size="small" variant="contained" color="inherit" sx={{ fontSize: 11, borderRadius: 0, px: 1.5, bgcolor: palette.SURFACE_ALT, color: palette.TEXT }}>Tbl</Button>
            <Button size="small" sx={{ fontSize: 11, borderRadius: 0, px: 1.5, color: palette.TEXT_MUTED }}>Map</Button>
          </Box>
        </Stack>
      </Paper>
      {/* inline filter chips (only when screener has filters) */}
      <Paper elevation={0} sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, border: 1, borderColor: palette.BORDER, borderRadius: 2, bgcolor: palette.SURFACE }}>
        <Typography variant="caption" sx={{ fontSize: 11, color: palette.TEXT_MUTED, fontWeight: 600 }}>Filters:</Typography>
        <Chip size="small" label="Min Vol 50k" sx={{ fontSize: 11, height: 24, bgcolor: palette.SURFACE_ALT, color: palette.TEXT, border: 1, borderColor: palette.BORDER }} />
        <Chip size="small" label="RSI 50-70" sx={{ fontSize: 11, height: 24, bgcolor: palette.SURFACE_ALT, color: palette.TEXT, border: 1, borderColor: palette.BORDER }} />
        <Chip size="small" label="Near 52W 3%" sx={{ fontSize: 11, height: 24, bgcolor: palette.SURFACE_ALT, color: palette.TEXT, border: 1, borderColor: palette.BORDER }} />
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" color="inherit" sx={{ fontSize: 11, height: 24, borderColor: palette.BORDER, color: palette.TEXT }}>Apply</Button>
      </Paper>
      <Paper elevation={0} sx={{ p: 1, border: 1, borderColor: palette.BORDER, borderRadius: 2, flex: 1, bgcolor: palette.SURFACE }}><MockTable /></Paper>
      <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, fontSize: 11 }}>+164px reclaimed (no side panel) • 1 Paper header • 8pt grid (p1/gap1) • status centered, controls nowrap</Typography>
    </Box>
  );
}

export const UnifiedToolbar: StoryObj = { render: () => <OptionA /> };

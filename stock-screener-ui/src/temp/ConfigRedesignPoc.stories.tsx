import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import * as palette from "@/ui/palette";

const meta: Meta = {
  title: "Temp/Config Redesign POC",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    backgrounds: { default: "dark" },
    docs: { description: { component: "POC for Config tab — simple MUI black theme (BG #0D1117, SURFACE #161B22, BORDER #30363D, no blue). 8pt grid, dense 20px rows, single-card layout matching Screener unified toolbar." } },
  },
};
export default meta;

const MOCK_CONFIGS = [
  { id: "trending", label: "Trending", desc: "Balanced trend + momentum • 5 cols" },
  { id: "52w_high", label: "52W High", desc: "Near 52W breakout • 6 cols" },
  { id: "volume_surge", label: "Volume Surge", desc: "Vol surge + RSI • 4 cols" },
];

function MockPreviewTable() {
  return (
    <Box sx={{ border: 1, borderColor: palette.BORDER, borderRadius: 1, overflow: "hidden", bgcolor: palette.SURFACE }}>
      <Box sx={{ display: "flex", gap: 0, bgcolor: palette.SURFACE_ALT, px: 1, py: 0.75, borderBottom: 1, borderColor: palette.BORDER }}>
        <Typography variant="caption" sx={{ flex: 1, fontWeight: 600, color: palette.TEXT_MUTED, fontSize: 11 }}>Symbol</Typography>
        <Typography variant="caption" sx={{ width: 70, textAlign: "right", fontWeight: 600, color: palette.TEXT_MUTED, fontSize: 11 }}>Score</Typography>
        <Typography variant="caption" sx={{ width: 70, textAlign: "right", fontWeight: 600, color: palette.TEXT_MUTED, fontSize: 11 }}>Day %</Typography>
        <Typography variant="caption" sx={{ width: 70, textAlign: "right", fontWeight: 600, color: palette.TEXT_MUTED, fontSize: 11 }}>RSI</Typography>
      </Box>
      {["RELIANCE", "TCS", "INFY", "HDFC"].map((s, i) => (
        <Box key={s} sx={{ display: "flex", gap: 0, px: 1, py: 0.5, borderBottom: 1, borderColor: palette.BORDER, "&:last-child": { borderBottom: 0 }, height: 20, alignItems: "center", bgcolor: palette.SURFACE, "&:hover": { bgcolor: palette.SURFACE_ALT } }}>
          <Typography variant="body2" sx={{ flex: 1, fontSize: 11, fontWeight: 600, color: palette.TEXT }}>{s}</Typography>
          <Typography variant="body2" sx={{ width: 70, textAlign: "right", fontSize: 11, color: palette.TEXT_MUTED }}>{92 - i * 5}</Typography>
          <Typography variant="body2" sx={{ width: 70, textAlign: "right", fontSize: 11, color: i % 2 ? palette.POSITIVE : palette.NEGATIVE }}>{i % 2 ? "+1.2%" : "-0.8%"}</Typography>
          <Typography variant="body2" sx={{ width: 70, textAlign: "right", fontSize: 11, color: palette.TEXT_MUTED }}>{65 + i}</Typography>
        </Box>
      ))}
    </Box>
  );
}

function OptionA() {
  const [active, setActive] = useState("trending");
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 2, bgcolor: palette.BG, minHeight: 420 }}>
      <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, fontWeight: 700, letterSpacing: 0.5 }}>OPTION A — Unified Config (List + Preview in single card, dense)</Typography>
      <Box sx={{ display: "flex", gap: 1, flex: 1, minHeight: 320 }}>
        {/* Left list — 240px dense */}
        <Paper elevation={0} sx={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden", border: 1, borderColor: palette.BORDER, borderRadius: 2, bgcolor: palette.SURFACE }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 1.5, py: 1, borderBottom: 1, borderColor: palette.BORDER, bgcolor: palette.SURFACE_ALT, height: 36 }}>
            <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: palette.TEXT_MUTED }}>CONFIGS</Typography>
            <Button size="small" variant="outlined" color="inherit" sx={{ fontSize: 11, height: 24, borderColor: palette.BORDER, color: palette.TEXT }}>+ Create</Button>
          </Box>
          <Box sx={{ flex: 1, overflow: "auto", p: 1, display: "flex", flexDirection: "column", gap: 0.5 }}>
            {MOCK_CONFIGS.map((c) => (
              <Box key={c.id} onClick={() => setActive(c.id)} sx={{ p: 1, borderRadius: 1, cursor: "pointer", bgcolor: active === c.id ? palette.SURFACE_ALT : "transparent", border: 1, borderColor: active === c.id ? palette.BORDER : "transparent" }}>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
                  <Typography variant="caption" sx={{ fontSize: 12, fontWeight: 600, color: palette.TEXT }}>{c.label}</Typography>
                  <Box sx={{ display: "flex", gap: 0.5 }}>
                    {active === c.id && <Chip size="small" label="Active" sx={{ fontSize: 10, height: 18, bgcolor: palette.SURFACE_ALT, color: palette.TEXT_MUTED, border: 1, borderColor: palette.BORDER }} />}
                    <Button size="small" variant="outlined" color="inherit" sx={{ fontSize: 10, height: 18, minWidth: 32, p: 0, borderColor: palette.BORDER, color: palette.TEXT }} onClick={(e: any) => e.stopPropagation()}>Edit</Button>
                  </Box>
                </Box>
                <Typography variant="caption" sx={{ fontSize: 11, color: palette.TEXT_MUTED, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.desc}</Typography>
              </Box>
            ))}
          </Box>
        </Paper>
        {/* Right preview — single card */}
        <Paper elevation={0} sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", border: 1, borderColor: palette.BORDER, borderRadius: 2, bgcolor: palette.SURFACE }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, borderBottom: 1, borderColor: palette.BORDER, bgcolor: palette.SURFACE_ALT, height: 36, flexShrink: 0 }}>
            <Chip size="small" label={MOCK_CONFIGS.find((c) => c.id === active)?.label || active} sx={{ fontSize: 11, height: 20, bgcolor: palette.SURFACE, color: palette.TEXT, border: 1, borderColor: palette.BORDER }} />
            <Chip size="small" label="rsi: 50" sx={{ fontSize: 11, height: 20, bgcolor: palette.SURFACE, color: palette.TEXT_MUTED, border: 1, borderColor: palette.BORDER }} />
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" sx={{ fontSize: 11, color: palette.TEXT_MUTED }}>PREVIEW (4)</Typography>
            <Button size="small" variant="outlined" color="inherit" sx={{ fontSize: 11, height: 24, borderColor: palette.BORDER }}>↻</Button>
          </Box>
          <Box sx={{ flex: 1, overflow: "auto", p: 1 }}><MockPreviewTable /></Box>
        </Paper>
      </Box>
      <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, fontSize: 11 }}>Dense 20px rows • single border per card • 8pt gap • no blue (grey active) • embedded preview (was separate Paper + double scroll)</Typography>
    </Box>
  );
}

export const UnifiedConfig: StoryObj = { render: () => <OptionA /> };

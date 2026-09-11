// ReplayControls — presentational playback control strip (play/pause, speed, scrub slider,
// clock/trade summary + loading/error chips). Strategy-specific parameter controls are
// injected via `children` so this core component stays strategy-agnostic.
import type { ReactNode } from "react";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { TZ_IST } from "@/config/constants";

export const SPEEDS = [1, 5, 15, 60, 300];

const fmtT = (ts: number) =>
  new Date(ts * 1000).toLocaleString("en-IN", { timeZone: TZ_IST, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export interface ReplayControlsProps {
  playing: boolean;
  loading: boolean;
  disabled: boolean;
  speed: number;
  t0: number;
  tEnd: number;
  clock: number;
  closedCount: number;
  revealedCount: number;
  net: number;
  error?: string;
  onPlayToggle: () => void;
  onSpeedChange: (speed: number) => void;
  onJump: (t: number) => void;
  /** strategy-specific parameter controls rendered after Speed */
  children?: ReactNode;
}

export default function ReplayControls({
  playing, loading, disabled, speed, t0, tEnd, clock,
  closedCount, revealedCount, net, error,
  onPlayToggle, onSpeedChange, onJump, children,
}: ReplayControlsProps) {
  return (
    <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center", flexWrap: "wrap" }}>
      <Button size="small" variant="contained" onClick={onPlayToggle} disabled={disabled}>
        {playing ? "⏸ Pause" : "▶ Play"}
      </Button>
      <TextField size="small" select value={speed} onChange={e => onSpeedChange(Number(e.target.value))} sx={{ width: 110 }} label="Speed">
        {SPEEDS.map(s => <MenuItem key={s} value={s}>{s}x</MenuItem>)}
      </TextField>
      {children}
      <Box sx={{ flex: 1, minWidth: 200, px: 1 }}>
        <Slider size="small" min={t0} max={tEnd} step={1} value={Math.round(clock)}
          onChange={(_, v) => onJump(v as number)} aria-label="replay position" />
      </Box>
      <Typography variant="caption" sx={{ color: "#E5E7EB", fontFamily: "monospace" }}>
        {clock > 0 ? fmtT(clock) : "--:--:--"} · {closedCount}/{revealedCount} closed · net {net > 0 ? "+" : ""}{net.toFixed(1)}
      </Typography>
      {loading && <Chip size="small" label="loading ticks…" sx={{ bgcolor: "#1F2937", color: "#58A6FF" }} />}
      {error && <Chip size="small" label={error} sx={{ bgcolor: "#3B1D1D", color: "#F87171" }} />}
    </Stack>
  );
}

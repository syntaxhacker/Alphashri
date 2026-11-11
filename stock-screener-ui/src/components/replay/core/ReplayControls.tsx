// ReplayControls — presentational playback control strip (play/pause, speed, scrub slider,
// clock/trade summary + loading/error chips). Strategy-specific parameter controls are
// injected via `children` so this core component stays strategy-agnostic.
import type { ReactNode } from "react";
import { Stack, Box, Button, Select, Text, Chip } from "@/ui";
import { fmtClock } from "../format";
import * as palette from "@/ui/palette";

export const SPEEDS = [1, 5, 15, 60, 300];

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
    <Stack direction="row" gap="sm" mb="sm" align="center" wrap>
      <Button size="sm" variant="filled" onClick={onPlayToggle} disabled={disabled}>
        {playing ? "⏸ Pause" : "▶ Play"}
      </Button>
      <Select
        size="sm"
        w={110}
        value={String(speed)}
        onChange={(v) => onSpeedChange(Number(v ?? ""))}
        label="Speed"
        data-testid="replay-speed-select"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}x
          </option>
        ))}
      </Select>
      {children}
      <Box flex="1" miw={200} px="sm">
        <input
          type="range"
          min={t0}
          max={tEnd}
          step={1}
          value={Math.round(clock)}
          onChange={(e) => onJump(Number((e.target as HTMLInputElement).value))}
          aria-label="replay position"
          className="w-full"
          style={{ accentColor: palette.PRIMARY }}
        />
      </Box>
      <Text size="xs" className="font-mono" style={{ color: "#E5E7EB" }}>
        {clock > 0 ? fmtClock(clock) : "--:--:--"} · {closedCount}/{revealedCount} closed · net {net > 0 ? "+" : ""}{net.toFixed(1)}
      </Text>
      {loading && <Chip size="small" children="loading ticks…" style={{ backgroundColor: "#1F2937", color: palette.PRIMARY }} />}
      {error && <Chip size="small" children={error} style={{ backgroundColor: "#3B1D1D", color: "#F87171" }} />}
    </Stack>
  );
}

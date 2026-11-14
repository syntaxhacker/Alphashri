// ReplayControls — presentational playback control strip (play/pause, speed, scrub slider,
// clock/trade summary + loading/error chips). Strategy-specific parameter controls are
// injected via `children` so this core component stays strategy-agnostic.
import { For, type JSX } from "solid-js";
import { Button, Select, Text, Chip, Stack, Box } from "@/ui";
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
  children?: JSX.Element;
}

export default function ReplayControls(props: ReplayControlsProps) {
  return (
    <Stack direction="row" gap="sm" mb="sm" align="center" wrap>
      <Button size="sm" variant="filled" onClick={props.onPlayToggle} disabled={props.disabled}>
        {props.playing ? "⏸ Pause" : "▶ Play"}
      </Button>
      <Select
        size="sm"
        w={110}
        value={String(props.speed)}
        onChange={(v) => props.onSpeedChange(Number(v ?? ""))}
        label="Speed"
        data-testid="replay-speed-select"
      >
        <For each={SPEEDS}>{(s) => (
          <option value={s}>
            {s}x
          </option>
        )}</For>
      </Select>
      {props.children}
      <Box flex="1" miw={200} px="sm">
        <input
          type="range"
          min={props.t0}
          max={props.tEnd}
          step={1}
          value={Math.round(props.clock)}
          onInput={(e) => props.onJump(Number(e.currentTarget.value))}
          aria-label="replay position"
          class="w-full"
          style={{ "accent-color": palette.PRIMARY }}
        />
      </Box>
      <Text size="xs" className="font-mono tabular-nums" style={{ color: palette.REPLAY_CHART_TEXT }}>
        {props.clock > 0 ? fmtClock(props.clock) : "--:--:--"} · {props.closedCount}/{props.revealedCount} closed · net {props.net > 0 ? "+" : ""}{props.net.toFixed(1)}
      </Text>
      {props.loading && <Chip size="sm" style={{ "background-color": palette.REPLAY_CHIP_BG, color: palette.PRIMARY }}>loading ticks…</Chip>}
      {props.error && <Chip size="sm" style={{ "background-color": palette.REPLAY_CHIP_BG_ERROR, color: palette.REPLAY_CHIP_TEXT_ERROR }}>{props.error}</Chip>}
    </Stack>
  );
}

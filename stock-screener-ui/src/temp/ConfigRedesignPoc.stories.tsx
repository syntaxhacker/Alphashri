import type { Meta, StoryObj } from "@storybook/react-vite";
import { For, Show, createSignal } from "solid-js";
import { Box, Paper, Chip, Button, Text } from "@/ui";
import * as palette from "@/ui/palette";

const meta: Meta = {
  title: "Temp/Config Redesign POC",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    backgrounds: { default: "dark" },
    docs: { description: { component: "POC for Config tab — simple dark theme (BG #0D1117, SURFACE #161B22, BORDER #30363D, no blue). 8pt grid, dense 20px rows, single-card layout matching Screener unified toolbar." } },
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
    <Box className="border border-[#30363D] rounded-sm overflow-hidden" style={{ "background-color": palette.SURFACE }}>
      <Box className="flex gap-0 px-1 py-[12px] border-b border-[#30363D]" style={{ "background-color": palette.SURFACE_ALT }}>
        <Text className="flex-1 font-semibold text-[11px]" style={{ color: palette.TEXT_MUTED }}>
          Symbol
        </Text>
        <Text className="w-[70px] text-right font-semibold text-[11px]" style={{ color: palette.TEXT_MUTED }}>
          Score
        </Text>
        <Text className="w-[70px] text-right font-semibold text-[11px]" style={{ color: palette.TEXT_MUTED }}>
          Day %
        </Text>
        <Text className="w-[70px] text-right font-semibold text-[11px]" style={{ color: palette.TEXT_MUTED }}>
          RSI
        </Text>
      </Box>
      <For each={["RELIANCE", "TCS", "INFY", "HDFC"]}>{(s, i) => (
        <Box
          key={s}
          className="flex gap-0 px-1 py-2 border-b border-[#30363D] h-5 items-center last:border-b-0"
          style={{
            "background-color": palette.SURFACE,
            "&:hover": { "background-color": palette.SURFACE_ALT },
          }}
        >
          <Text className="flex-1 font-semibold text-[11px]" style={{ color: palette.TEXT }}>
            {s}
          </Text>
          <Text className="w-[70px] text-right text-[11px]" style={{ color: palette.TEXT_MUTED }}>
            {92 - i * 5}
          </Text>
          <Text className="w-[70px] text-right text-[11px]" style={{ color: i % 2 ? palette.POSITIVE : palette.NEGATIVE }}>
            {i % 2 ? "+1.2%" : "-0.8%"}
          </Text>
          <Text className="w-[70px] text-right text-[11px]" style={{ color: palette.TEXT_MUTED }}>
            {65 + i}
          </Text>
        </Box>
      )}</For>
    </Box>
  );
}

function OptionA() {
  const [active, setActive] = createSignal("trending");
  return (
    <Box className="flex flex-col gap-2 p-2 min-h-[420px]" style={{ "background-color": palette.BG }}>
      <Text className="text-[#8B949E] font-bold tracking-[0.5px] text-[11px]">
        OPTION A — Unified Config (List + Preview in single card, dense)
      </Text>
      <Box className="flex gap-2 flex-1 min-h-[320px]">
        {/* Left list — 240px dense */}
        <Paper
          className="w-60 shrink-0 flex flex-col overflow-hidden border border-[#30363D] rounded-lg"
          style={{ "background-color": palette.SURFACE }}
        >
          <Box className="flex items-center justify-between px-1.5 py-[10px] border-b border-[#30363D] h-[36px] shrink-0" style={{ "background-color": palette.SURFACE_ALT }}>
            <Text className="text-[11px] font-bold tracking-[0.5px]" style={{ color: palette.TEXT_MUTED }}>
              CONFIGS
            </Text>
            <Button size="xs" variant="outline" color="secondary" className="text-[11px] h-6 border border-[#30363D] text-[#F0F6FC]">
              + Create
            </Button>
          </Box>
          <Box className="flex-1 overflow-auto p-1 flex flex-col gap-1">
            <For each={MOCK_CONFIGS}>{(c) => (
              <Box
                key={c.id}
                onClick={() => setActive(c.id)}
                className="p-1 rounded-sm cursor-pointer transition-colors border"
                style={{
                  "background-color": active() === c.id ? palette.SURFACE_ALT : "transparent",
                  "border-color": active() === c.id ? palette.BORDER : "transparent",
                }}
              >
                <Box className="flex items-center justify-between mb-1">
                  <Text className="text-[12px] font-semibold" style={{ color: palette.TEXT }}>
                    {c.label}
                  </Text>
                  <Box className="flex gap-1">
                    <Show when={active() === c.id}>
                      <Chip size="xs" label="Active" className="text-[10px] h-[18px] text-[#8B949E] border border-[#30363D]" style={{ "background-color": palette.SURFACE_ALT }} />
                    </Show>
                    <Button size="xs" variant="outline" color="secondary" className="text-[10px] h-[18px] min-w-[32px] px-0 border border-[#30363D] text-[#F0F6FC]" onClick={(e: any) => e.stopPropagation()}>
                      Edit
                    </Button>
                  </Box>
                </Box>
                <Text className="text-[11px] text-[#8B949E] block whitespace-nowrap overflow-hidden text-ellipsis">
                  {c.desc}
                </Text>
              </Box>
            )}</For>
          </Box>
        </Paper>
        {/* Right preview — single card */}
        <Paper
          className="flex-1 flex flex-col overflow-hidden border border-[#30363D] rounded-lg"
          style={{ "background-color": palette.SURFACE }}
        >
          <Box className="flex items-center gap-2 px-1.5 py-[10px] border-b border-[#30363D] shrink-0 h-[36px]" style={{ "background-color": palette.SURFACE_ALT }}>
            <Chip size="xs" label={MOCK_CONFIGS.find((c) => c.id === active())?.label || active()} className="text-[11px] h-5 text-[#F0F6FC] border border-[#30363D]" style={{ "background-color": palette.SURFACE }} />
            <Chip size="xs" label="rsi: 50" className="text-[11px] h-5 text-[#8B949E] border border-[#30363D]" style={{ "background-color": palette.SURFACE }} />
            <Box className="flex-1" />
            <Text className="text-[11px] text-[#8B949E]">PREVIEW (4)</Text>
            <Button size="xs" variant="outline" color="secondary" className="text-[11px] h-6 border border-[#30363D]">
              ↻
            </Button>
          </Box>
          <Box className="flex-1 overflow-auto p-1">
            <MockPreviewTable />
          </Box>
        </Paper>
      </Box>
      <Text className="text-[#8B949E] text-[11px]">
        Dense 20px rows • single border per card • 8pt gap • no blue (grey active) • embedded preview (was separate Paper + double scroll)
      </Text>
    </Box>
  );
}

export const UnifiedConfig: StoryObj = { render: () => <OptionA /> };

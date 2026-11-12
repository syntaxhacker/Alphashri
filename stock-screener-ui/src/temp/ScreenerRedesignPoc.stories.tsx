import type { Meta, StoryObj } from "@storybook/react-vite";
import { For, createSignal } from "solid-js";
import { Box, Paper, Stack, Button, Text, Chip, ActionIcon, Select, Tooltip, Tabs } from "@/ui";
import { IconRefresh, IconTable, IconChartDots, IconSettings } from "@tabler/icons-react";
import * as palette from "@/ui/palette";

const meta: Meta = {
  title: "Temp/Screener Redesign POC",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    backgrounds: { default: "dark" },
    docs: { description: { component: "POC for compact screener redesign — simple dark theme (BG #0D1117, SURFACE #161B22, BORDER #30363D, no blue). 8pt grid, FIN 48px header. All temp, not for production." } },
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
    <Box className="border border-[#30363D] rounded-sm overflow-hidden" style={{ "background-color": palette.SURFACE }}>
      <Box className="flex gap-0 bg-[#21262D] px-2 py-2 border-b border-[#30363D]">
        <Text className="flex-1 font-semibold text-[11px]" style={{ color: palette.TEXT_MUTED }}>
          Symbol
        </Text>
        <Text className="w-[90px] text-right font-semibold text-[11px]" style={{ color: palette.TEXT_MUTED }}>
          Price
        </Text>
        <Text className="w-[80px] text-right font-semibold text-[11px]" style={{ color: palette.TEXT_MUTED }}>
          Change
        </Text>
        <Text className="w-[70px] text-right font-semibold text-[11px]" style={{ color: palette.TEXT_MUTED }}>
          Score
        </Text>
      </Box>
      <For each={MOCK_ROWS}>{(r) => (
        <Box
          key={r.symbol}
          className="flex gap-0 px-2 py-2 border-b border-[#30363D] last:border-b-0 h-7 items-center"
          style={{
            "background-color": palette.SURFACE,
            "&:hover": { "background-color": palette.SURFACE_ALT },
          }}
        >
          <Text className="flex-1 font-semibold text-[12px]" style={{ color: palette.TEXT }}>
            {r.symbol}
          </Text>
          <Text className="w-[90px] text-right text-[12px]" style={{ color: palette.TEXT }}>
            {r.price ? `₹${r.price}` : r.price}
          </Text>
          <Text
            className="w-[80px] text-right text-[12px] font-semibold"
            style={{ color: r.change.startsWith("+") ? palette.POSITIVE : palette.NEGATIVE }}
          >
            {r.change}
          </Text>
          <Text className="w-[70px] text-right text-[12px]" style={{ color: palette.TEXT_MUTED }}>
            {95 - MOCK_ROWS.indexOf(r) * 3}
          </Text>
        </Box>
      )}</For>
    </Box>
  );
}

// ---- Option A : Unified Toolbar (recommended, minimal risk) ----
function OptionA() {
  const [tab, setTab] = createSignal(0);
  const [screener, setScreener] = createSignal("trending");
  const [provider, setProvider] = createSignal("upstox");
  const [mode, setMode] = createSignal("intraday");
  return (
    <Box className="flex flex-col gap-2 p-2 min-h-[420px]" style={{ "background-color": palette.BG }}>
      <Text className="text-[#8B949E] font-bold tracking-[0.5px] text-[11px]">
        OPTION A — Unified 48px Toolbar (Recommended)
      </Text>
      {/* single Paper bar — 48px header, elevation 0 + 1px border, radius 8 */}
      <Paper
        className="flex items-center justify-between gap-2 px-2 h-12 min-h-[48px] max-h-[48px] border border-[#30363D] rounded-lg overflow-hidden flex-nowrap"
        style={{ "background-color": palette.SURFACE }}
      >
        <Box className="flex items-center gap-1.5 shrink-0">
          <Select
            size="xs"
            value={screener()}
            onChange={(v) => setScreener(v ?? "trending")}
            label="Screener"
            data={SCREENER_OPTS}
            className="min-w-[140px] text-[12px] h-8"
          />
          <Tabs value={String(tab())} onChange={(v) => setTab(Number(v ?? 0))} className="min-h-[32px]">
            <Tabs.List className="min-h-[32px]">
              <Tabs.Tab value="0" icon={<IconTable size={14} />} label="Screener" className="text-[12px] py-0 min-w-[90px]" />
              <Tabs.Tab value="1" icon={<IconChartDots size={14} />} label="Correlation" className="text-[12px] py-0 min-w-[90px]" />
              <Tabs.Tab value="2" icon={<IconSettings size={14} />} label="Config" className="text-[12px] py-0 min-w-[90px]" />
            </Tabs.List>
          </Tabs>
        </Box>
        <Box className="flex-1 min-w-0 px-1 flex justify-center overflow-hidden">
          <Text className="text-[11px]" style={{ color: palette.TEXT_MUTED, "white-space": "nowrap" }}>
            48 stocks • 2s • live
          </Text>
        </Box>
        <Stack direction="row" gap={1} className="shrink-0 flex-nowrap">
          <Tooltip label="Refresh">
            <ActionIcon size="sm" className="text-[#8B949E] border border-[#30363D]">
              <IconRefresh size={14} />
            </ActionIcon>
          </Tooltip>
          <TextInput
            size="xs"
            defaultValue={60}
            className="w-[64px] text-[12px] px-2 py-1.5 text-[#F0F6FC] border border-[#30363D] rounded-sm"
            placeholder="60s"
            style={{ "background-color": palette.SURFACE_ALT }}
          />
          <Select
            size="xs"
            value={provider()}
            onChange={(v) => setProvider(v ?? "upstox")}
            label="Provider"
            data={[
              { value: "upstox", label: "Upstox" },
              { value: "indmoney", label: "IND" },
            ]}
            className="min-w-[96px] text-[12px] h-8 text-[#F0F6FC]"
            style={{ "background-color": palette.SURFACE_ALT }}
          />
          <Select
            size="xs"
            value={mode()}
            onChange={(v) => setMode(v ?? "intraday")}
            label="Mode"
            data={[
              { value: "intraday", label: "Intra" },
              { value: "historical", label: "5D" },
            ]}
            className="min-w-[96px] text-[12px] h-8 text-[#F0F6FC]"
            style={{ "background-color": palette.SURFACE_ALT }}
          />
          <Box className="flex border border-[#30363D] rounded-sm overflow-hidden h-8">
            <Button size="xs" variant="filled" color="secondary" className="text-[11px] rounded-none px-6 text-[#F0F6FC]" style={{ "background-color": palette.SURFACE_ALT }}>
              Tbl
            </Button>
            <Button size="xs" className="text-[11px] rounded-none px-6 text-[#8B949E]">
              Map
            </Button>
          </Box>
        </Stack>
      </Paper>
      {/* inline filter chips (only when screener has filters) */}
      <Paper
        className="flex items-center gap-2 px-3 py-2 border border-[#30363D] rounded-lg"
        style={{ "background-color": palette.SURFACE }}
      >
        <Text className="text-[11px] text-[#8B949E] font-semibold">Filters:</Text>
        <Chip size="xs" label="Min Vol 50k" className="text-[11px] h-6 text-[#F0F6FC] border border-[#30363D]" style={{ "background-color": palette.SURFACE_ALT }} />
        <Chip size="xs" label="RSI 50-70" className="text-[11px] h-6 text-[#F0F6FC] border border-[#30363D]" style={{ "background-color": palette.SURFACE_ALT }} />
        <Chip size="xs" label="Near 52W 3%" className="text-[11px] h-6 text-[#F0F6FC] border border-[#30363D]" style={{ "background-color": palette.SURFACE_ALT }} />
        <Box className="flex-1" />
        <Button size="xs" variant="outline" color="secondary" className="text-[11px] h-6 border border-[#30363D] text-[#F0F6FC]">
          Apply
        </Button>
      </Paper>
      <Paper className="p-1 border border-[#30363D] rounded-lg flex-1" style={{ "background-color": palette.SURFACE }}>
        <MockTable />
      </Paper>
      <Text className="text-[#8B949E] text-[11px]">
        +164px reclaimed (no side panel) • 1 Paper header • 8pt grid (p1/gap1) • status centered, controls nowrap
      </Text>
    </Box>
  );
}

export const UnifiedToolbar: StoryObj = { render: () => <OptionA /> };

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@/ui";
import { SectorTable } from "@/components/sector/SectorTable";
import { IntervalMoversTable } from "@/components/sector/IntervalMoversTable";
import { MOCK_SECTOR_STOCKS } from "@/stories/fixtures";
import type { SectorItem } from "@/types/sector";

function buildSectors(): SectorItem[] {
  const bySector = new Map<string, typeof MOCK_SECTOR_STOCKS>();
  for (const s of MOCK_SECTOR_STOCKS) {
    const arr = bySector.get(s.sector) ?? [];
    arr.push(s as any);
    bySector.set(s.sector, arr);
  }
  return [...bySector.entries()].map(([sector, stocks]) => ({
    sector, stock_count: stocks.length, avg_change: +(stocks.reduce((a, b) => a + b.change_pct, 0) / stocks.length).toFixed(2),
    advances: stocks.filter(s => s.change_pct > 0).length, declines: stocks.filter(s => s.change_pct < 0).length,
    avg_rsi: 55, avg_adx: 22, top_movers: stocks.slice(0, 3).map(s => s.symbol).join(", "),
  }));
}
const mockSectors = buildSectors();
const mockMovers = MOCK_SECTOR_STOCKS.slice(0, 6).map(s => ({ symbol: s.symbol, change: s.change_pct, prev_change: s.change_pct - 0.8, delta: 0.8 }));

const meta: Meta = { title: "Patterns/Tables/SectorTables", tags: ["autodocs"], parameters: { layout: "padded" } };
export default meta;

export const SectorTableDefault: StoryObj = { name: "SectorTable — Default", render: () => <Box p="sm"><SectorTable sectors={mockSectors} /></Box> };
export const SectorTableEmpty: StoryObj = { name: "SectorTable — Empty", render: () => <Box p="sm"><SectorTable sectors={[]} /></Box> };
export const IntervalMoversDefault: StoryObj = { name: "IntervalMovers — Default", render: () => <Box p="sm"><IntervalMoversTable movers={mockMovers as any} /></Box> };
export const IntervalMoversEmpty: StoryObj = { name: "IntervalMovers — Empty", render: () => <Box p="sm"><IntervalMoversTable movers={[]} /></Box> };

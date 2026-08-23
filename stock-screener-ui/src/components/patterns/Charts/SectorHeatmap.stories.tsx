import { MemoryRouter } from "react-router-dom";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@/ui";
import { SectorHeatmapView } from "@/components/sector/SectorHeatmapView";
import { MOCK_SECTOR_STOCKS } from "@/stories/fixtures";
import type { SectorItem } from "@/types/sector";

function buildSectors(): SectorItem[] {
  const bySector = new Map<string, typeof MOCK_SECTOR_STOCKS>();
  for (const s of MOCK_SECTOR_STOCKS) { const a = bySector.get(s.sector) ?? []; a.push(s as any); bySector.set(s.sector, a); }
  return [...bySector.entries()].map(([sector, stocks]) => ({
    sector, stock_count: stocks.length, avg_change: +(stocks.reduce((a, b) => a + b.change_pct, 0) / stocks.length).toFixed(2),
    advances: stocks.filter(s => s.change_pct > 0).length, declines: stocks.filter(s => s.change_pct < 0).length,
    avg_rsi: 55, avg_adx: 22, top_movers: stocks.slice(0, 2).map(s => s.symbol).join(", "),
  }));
}
const mockSectors = buildSectors();

const meta: Meta<typeof SectorHeatmapView> = {
  title: "Patterns/Charts/SectorHeatmap",
  tags: ["autodocs"],
  decorators: [(Story) => <MemoryRouter><Story /></MemoryRouter>],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "SectorHeatmap pattern — ECharts treemap/heatmap for sector performance (`SectorHeatmapView`). Use for sector-level breadth view filtered by metric (change_pct, RSI, etc.) and `viewMode`. When not: for symbol correlation matrix use CorrelationHeatmap; for tabular sector data use SectorTable.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof SectorHeatmapView>;

export const Default: Story = {
  render: () => <Box h={400} p="sm"><SectorHeatmapView sectors={mockSectors} stocks={[]} metric="change_pct" onMetricChange={() => {}} sectorFilter={null} onSectorFilterChange={() => {}} sectorOptions={[]} lastUpdated={new Date().toISOString()} loading={false} viewMode="sector" onViewModeChange={() => {}} /></Box>,
};
export const Empty: Story = {
  render: () => <Box h={400} p="sm"><SectorHeatmapView sectors={[]} stocks={[]} metric="change_pct" onMetricChange={() => {}} sectorFilter={null} onSectorFilterChange={() => {}} sectorOptions={[]} lastUpdated={null} loading={false} viewMode="sector" onViewModeChange={() => {}} /></Box>,
};

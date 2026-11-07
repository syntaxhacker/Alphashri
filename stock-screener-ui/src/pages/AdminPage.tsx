import { Box, Tabs, Text } from "@/ui";
import { PatternImageManager } from "../components/patterns/PatternImageManager";
import { LLMStatsPanel } from "./admin/LLMStatsPanel";
import { Admin52wRangePanel } from "./admin/Admin52wRangePanel";
import { NewsQueuePanel } from "./admin/NewsQueuePanel";
import { OrderFlowJournalPanel } from "./admin/OrderFlowJournalPanel";
import { AdminPatternTimeframesPanel } from "./admin/AdminPatternTimeframesPanel";

const PANEL_SX = { flex: 1, minHeight: 0, overflow: "auto", py: 0, px: 0 };

export default function AdminPage() {
  return (
    <Box
      data-testid="admin-page"
      sx={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      <Tabs
        defaultValue="llm"
        sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 0.5,
            flexShrink: 0,
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ fontSize: 10, letterSpacing: 0.6 }}>
            Admin
          </Text>
          <Tabs.List data-testid="admin-tabs">
            <Tabs.Tab value="llm">LLM stats</Tabs.Tab>
            <Tabs.Tab value="52w" data-testid="admin-tab-52w">52W range batch</Tabs.Tab>
            <Tabs.Tab value="orderflow" data-testid="admin-tab-orderflow">Order Flow data</Tabs.Tab>
            <Tabs.Tab value="news-queue" data-testid="admin-tab-news-queue">News Queue</Tabs.Tab>
            <Tabs.Tab value="pattern-timeframes" data-testid="admin-tab-pattern-timeframes">Pattern timeframes</Tabs.Tab>
            <Tabs.Tab value="pattern-images" data-testid="admin-tab-pattern-images">Pattern images</Tabs.Tab>
          </Tabs.List>
        </Box>
        <Tabs.Panel value="llm" sx={PANEL_SX}>
          <LLMStatsPanel />
        </Tabs.Panel>
        <Tabs.Panel value="52w" sx={PANEL_SX}>
          <Admin52wRangePanel />
        </Tabs.Panel>
        <Tabs.Panel value="orderflow" data-testid="admin-tab-panel-orderflow" sx={PANEL_SX}>
          <OrderFlowJournalPanel />
        </Tabs.Panel>
        <Tabs.Panel value="news-queue" sx={PANEL_SX}>
          <NewsQueuePanel />
        </Tabs.Panel>
        <Tabs.Panel value="pattern-timeframes" sx={PANEL_SX}>
          <AdminPatternTimeframesPanel />
        </Tabs.Panel>
        <Tabs.Panel value="pattern-images" sx={PANEL_SX}>
          <PatternImageManager />
        </Tabs.Panel>
      </Tabs>
    </Box>
  );
}

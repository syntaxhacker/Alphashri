import { Box, Tabs, Text } from "@/ui";
import { PatternImageManager } from "../components/patterns/PatternImageManager";
import { LLMStatsPanel } from "./admin/LLMStatsPanel";
import { Admin52wRangePanel } from "./admin/Admin52wRangePanel";
import { NewsQueuePanel } from "./admin/NewsQueuePanel";
import { OrderFlowJournalPanel } from "./admin/OrderFlowJournalPanel";
import { AdminPatternTimeframesPanel } from "./admin/AdminPatternTimeframesPanel";

const PANEL_CLASS = "flex-1 min-h-0 overflow-auto py-0 px-0";

export default function AdminPage() {
  return (
    <Box
      data-testid="admin-page"
      className="flex h-full flex-col overflow-hidden"
    >
      <Tabs
        defaultValue="llm"
        className="flex min-h-0 flex-1 flex-col"
      >
        <Box className="flex shrink-0 items-center gap-2 border-b border-fin-border px-1">
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ "font-size": "10px", "letter-spacing": "0.6px" }}>
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
        <Tabs.Panel value="llm" className={PANEL_CLASS}>
          <LLMStatsPanel />
        </Tabs.Panel>
        <Tabs.Panel value="52w" className={PANEL_CLASS}>
          <Admin52wRangePanel />
        </Tabs.Panel>
        <Tabs.Panel value="orderflow" data-testid="admin-tab-panel-orderflow" className={PANEL_CLASS}>
          <OrderFlowJournalPanel />
        </Tabs.Panel>
        <Tabs.Panel value="news-queue" className={PANEL_CLASS}>
          <NewsQueuePanel />
        </Tabs.Panel>
        <Tabs.Panel value="pattern-timeframes" className={PANEL_CLASS}>
          <AdminPatternTimeframesPanel />
        </Tabs.Panel>
        <Tabs.Panel value="pattern-images" className={PANEL_CLASS}>
          <PatternImageManager />
        </Tabs.Panel>
      </Tabs>
    </Box>
  );
}

import { Box, Tabs, Text, ToolbarRow } from "@/ui";
import { PatternImageManager } from "../components/patterns/PatternImageManager";
import { LLMStatsPanel } from "./admin/LLMStatsPanel";
import { Admin52wRangePanel } from "./admin/Admin52wRangePanel";
import { NewsQueuePanel } from "./admin/NewsQueuePanel";
import { OrderFlowJournalPanel } from "./admin/OrderFlowJournalPanel";
import { AdminPatternTimeframesPanel } from "./admin/AdminPatternTimeframesPanel";

/** Panels own their own scroll; the tab panel only supplies the flex box. */
const PANEL_CLASS = "min-w-0 min-h-0 flex-1 overflow-hidden flex flex-col";
const PANEL_BODY_CLASS = "flex min-h-0 flex-1 flex-col overflow-hidden px-1 pb-1";

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
        <ToolbarRow
          gap={8}
          wrap={false}
          className="shrink-0 border-b border-fin-border px-1"
          style={{ "min-height": "32px" }}
        >
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ "font-size": "10px", "letter-spacing": "0.6px" }}>
            Admin
          </Text>
          <Box className="min-w-0 flex-1 overflow-x-auto">
            <Tabs.List data-testid="admin-tabs">
              <Tabs.Tab value="llm">LLM stats</Tabs.Tab>
              <Tabs.Tab value="52w" data-testid="admin-tab-52w">52W range batch</Tabs.Tab>
              <Tabs.Tab value="orderflow" data-testid="admin-tab-orderflow">Order Flow data</Tabs.Tab>
              <Tabs.Tab value="news-queue" data-testid="admin-tab-news-queue">News Queue</Tabs.Tab>
              <Tabs.Tab value="pattern-timeframes" data-testid="admin-tab-pattern-timeframes">Pattern timeframes</Tabs.Tab>
              <Tabs.Tab value="pattern-images" data-testid="admin-tab-pattern-images">Pattern images</Tabs.Tab>
            </Tabs.List>
          </Box>
        </ToolbarRow>
        <Tabs.Panel value="llm" className={PANEL_CLASS}>
          <Box className={PANEL_BODY_CLASS}><LLMStatsPanel /></Box>
        </Tabs.Panel>
        <Tabs.Panel value="52w" className={PANEL_CLASS}>
          <Box className={PANEL_BODY_CLASS}><Admin52wRangePanel /></Box>
        </Tabs.Panel>
        <Tabs.Panel value="orderflow" data-testid="admin-tab-panel-orderflow" className={PANEL_CLASS}>
          <Box className={PANEL_BODY_CLASS}><OrderFlowJournalPanel /></Box>
        </Tabs.Panel>
        <Tabs.Panel value="news-queue" className={PANEL_CLASS}>
          <Box className={PANEL_BODY_CLASS}><NewsQueuePanel /></Box>
        </Tabs.Panel>
        <Tabs.Panel value="pattern-timeframes" className={PANEL_CLASS}>
          <AdminPatternTimeframesPanel />
        </Tabs.Panel>
        <Tabs.Panel value="pattern-images" className={PANEL_CLASS}>
          <Box className="min-h-0 flex-1 overflow-auto px-1 pb-1">
            <PatternImageManager />
          </Box>
        </Tabs.Panel>
      </Tabs>
    </Box>
  );
}
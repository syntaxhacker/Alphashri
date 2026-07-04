import { Box, Tabs } from "@mantine/core";
import { CompactPage } from "../components/common/compact";
import { LLMStatsPanel } from "./admin/LLMStatsPanel";
import { Admin52wRangePanel } from "./admin/Admin52wRangePanel";
import { NewsQueuePanel } from "./admin/NewsQueuePanel";

const TAB_STYLE = { flex: 1, minHeight: 0, overflow: "hidden" };

export default function AdminPage() {
  return (
    <Box data-testid="admin-page" h="100%" style={{ overflow: "hidden" }}>
      <CompactPage title="Admin" description="LLM telemetry, 52W range batch, and news analysis queue.">
        <Tabs
          defaultValue="llm"
          style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
        >
          <Tabs.List>
            <Tabs.Tab value="llm">LLM stats</Tabs.Tab>
            <Tabs.Tab value="52w" data-testid="admin-tab-52w">52W range batch</Tabs.Tab>
            <Tabs.Tab value="news-queue" data-testid="admin-tab-news-queue">News Queue</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="llm" pt="sm" style={TAB_STYLE}>
            <LLMStatsPanel />
          </Tabs.Panel>
          <Tabs.Panel value="52w" pt="sm" style={TAB_STYLE}>
            <Admin52wRangePanel />
          </Tabs.Panel>
          <Tabs.Panel value="news-queue" pt="sm" style={TAB_STYLE}>
            <NewsQueuePanel />
          </Tabs.Panel>
        </Tabs>
      </CompactPage>
    </Box>
  );
}

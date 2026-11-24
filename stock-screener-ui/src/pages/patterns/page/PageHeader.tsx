import { Box, Tabs } from "@/ui";
import type { JobDTO, PatternSummary } from "@/types/chartPatterns";
import { ScanStats } from "@/components/patterns/ScanStats";

export interface PageHeaderProps {
  displaySummary: () => PatternSummary | null;
  job: JobDTO | null;
  onSelectStat: (kind: "confirmed" | "bullish" | "bearish") => void;
}

export function PageHeader(props: PageHeaderProps) {
  return (
    <Box className="flex w-full min-w-0 items-stretch gap-2 border-b border-fin-border">
      <Tabs.List
        data-testid="patterns-tab-list"
        // The wrapper owns the single bottom rule; the list's own is
        // zeroed inline because `border-b-0` is not order-safe via cn().
        style={{ "border-bottom-width": "0px" }}
      >
        <Tabs.Tab value="scan" data-testid="patterns-tab-scan">
          Scan
        </Tabs.Tab>
        <Tabs.Tab value="watch" data-testid="patterns-tab-watch">
          Watch
        </Tabs.Tab>
      </Tabs.List>
      <Box className="ml-auto flex min-w-0 items-center overflow-x-auto">
        <ScanStats
          summary={props.displaySummary()}
          job={props.job}
          onSelect={props.onSelectStat}
        />
      </Box>
    </Box>
  );
}

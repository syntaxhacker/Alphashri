import { Tabs } from "@/ui";
import { WatchView } from "@/components/patterns/WatchView";
import type { PatternsPageModel } from "./usePatternsPage";

export type WatchPanelModel = Pick<
  PatternsPageModel,
  | "universe"
  | "timeframe"
  | "filters"
  | "openFromSymbol"
  | "requestSymbolPreview"
  | "endSymbolPreview"
>;

/** Watch tab shell. Preview callbacks stay page-owned so the tab can close the chart. */
export function WatchPanel(props: { model: WatchPanelModel }) {
  const m = props.model;
  return (
    <Tabs.Panel
      value="watch"
      data-testid="patterns-panel-watch"
      className="flex flex-1 min-h-0 flex-col overflow-hidden"
      style={{ "padding-top": 0, "padding-bottom": 0 }}
    >
      <WatchView
        universe={m.universe()}
        timeframe={m.timeframe()}
        minBaseDays={m.filters().min_base_days}
        onOpenSymbol={m.openFromSymbol}
        onSymbolPreview={m.requestSymbolPreview}
        onSymbolPreviewEnd={m.endSymbolPreview}
      />
    </Tabs.Panel>
  );
}

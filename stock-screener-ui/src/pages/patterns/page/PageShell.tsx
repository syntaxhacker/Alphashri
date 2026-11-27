import { Show, type JSX } from "solid-js";
import { Box, Tabs } from "@/ui";
import type { PatternsPageModel } from "./usePatternsPage";

export interface PageShellProps {
  model: Pick<PatternsPageModel, "activeTab" | "handleTabChange">;
  header: JSX.Element;
  scanPanel: JSX.Element;
  watchPanel: () => JSX.Element;
  overlays: JSX.Element;
}

/** Layout-only shell: owns the page frame and the scan/watch tab boundary. */
export function PageShell(props: PageShellProps) {
  return (
    <Box
      data-testid="patterns-page"
      className="flex h-full w-full flex-1 min-h-0 flex-col gap-2 overflow-hidden px-2 py-1"
    >
      <Tabs
        value={props.model.activeTab()}
        onChange={props.model.handleTabChange}
        data-testid="patterns-tabs"
        className="flex flex-1 min-h-0 flex-col overflow-hidden"
      >
        {props.header}
        {props.scanPanel}
        {/* WatchView streams its own data and arms timers. Constructing it in a
            hidden tab mounts all of that work eagerly; only create it when the
            tab is actually selected. */}
        <Show when={props.model.activeTab() === "watch"}>{props.watchPanel()}</Show>
      </Tabs>
      {props.overlays}
    </Box>
  );
}

import type { JSX } from "solid-js";
import { Box, Tabs } from "@/ui";
import type { PatternsPageModel } from "./usePatternsPage";

export interface PageShellProps {
  model: Pick<PatternsPageModel, "activeTab" | "handleTabChange">;
  header: JSX.Element;
  scanPanel: JSX.Element;
  watchPanel: JSX.Element;
  overlays: JSX.Element;
}

/** Layout-only shell: owns the page frame and the scan/watch tab boundary. */
export function PageShell(props: PageShellProps) {
  return (
    <Box
      data-testid="patterns-page"
      className="flex w-full flex-1 min-h-0 flex-col gap-2 px-2 py-1"
    >
      <Tabs
        value={props.model.activeTab()}
        onChange={props.model.handleTabChange}
        data-testid="patterns-tabs"
        className="flex flex-1 min-h-0 flex-col"
      >
        {props.header}
        {props.scanPanel}
        {props.watchPanel}
      </Tabs>
      {props.overlays}
    </Box>
  );
}

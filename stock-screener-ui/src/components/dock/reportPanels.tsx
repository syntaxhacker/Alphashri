import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import { Box, Text } from "@/ui";
import { DockHost } from "./DockHost";
import { normalizeLayout } from "./layout";
import type { DockLayout, DockPanelContext, DockPanelSpec } from "./types";

/**
 * Proof-of-contract harness: three report panels rendered through DockHost,
 * each reading only the shared context accessor — never a page-local signal.
 * Nothing here is wired into ReportWorkspace.
 */
export const REPORT_PANELS: DockPanelSpec[] = [
  {
    id: "report.chart",
    page: "report",
    title: "CHART",
    size: 1,
    minWidth: 320,
    singleton: true,
    requires: ["symbol"],
    mount: (ctx: Accessor<DockPanelContext>) => (
      <Box data-testid="demo-report-chart" className="flex h-full min-h-0 flex-col p-2">
        <Text size="xs">
          CHART · {ctx().symbol ?? "—"} · {ctx().timeframe ?? "—"}
        </Text>
      </Box>
    ),
  },
  {
    id: "report.walls",
    page: "report",
    title: "WALLS",
    size: 0.42,
    minWidth: 200,
    singleton: true,
    requires: [],
    mount: (ctx: Accessor<DockPanelContext>) => (
      <Box data-testid="demo-report-walls" className="flex h-full min-h-0 flex-col p-2">
        <Text size="xs">WALLS · {ctx().market ?? "—"}</Text>
      </Box>
    ),
  },
  {
    id: "report.breadth",
    page: "report",
    title: "BREADTH",
    size: 0.3,
    minWidth: 200,
    singleton: true,
    requires: ["expiry"],
    mount: (ctx: Accessor<DockPanelContext>) => (
      <Box data-testid="demo-report-breadth" className="flex h-full min-h-0 flex-col p-2">
        <Text size="xs">BREADTH · {ctx().expiry ?? "—"}</Text>
      </Box>
    ),
  },
];

export function ReportDockDemo(props: {
  stacked?: boolean;
  onLayoutChange?: (layout: DockLayout) => void;
}) {
  const [context] = createSignal<DockPanelContext>({
    symbol: "NIFTY",
    market: "india",
    timeframe: "1m",
    expiry: "2026-11-26",
  });
  const [layout, setLayout] = createSignal<DockLayout>(
    normalizeLayout(
      {
        panes: [
          { id: "report.chart", size: 1 },
          { id: "report.walls", size: 0.42 },
          { id: "report.breadth", size: 0.3 },
        ],
        hidden: [],
      },
      REPORT_PANELS,
    ),
  );
  const apply = (next: DockLayout) => {
    setLayout(next);
    props.onLayoutChange?.(next);
  };

  return (
    <DockHost
      specs={REPORT_PANELS}
      layout={layout()}
      context={context}
      onLayoutChange={apply}
      stacked={props.stacked}
    />
  );
}

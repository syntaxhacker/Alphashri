import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import { DockHost } from "./DockHost";
import { normalizeLayout } from "./layout";
import type { DockLayout, DockPanelCommands, DockPanelContext, DockPanelSpec } from "./types";
import {
  NiftyChartPanel,
  type ChartSize,
  type ChartTimeframe,
} from "@/pages/report/NiftyChartPanel";
import type { WallBurstLike } from "@/pages/report/niftyWallEventOverlay";
import type { SpotPoint } from "@/pages/report/niftyChartData";
import type { NiftyReport, NiftyReportMode, NiftyTape } from "@/types/niftyReport";

interface MaxWalls {
  calls: { strike: number; oi: number }[];
  puts: { strike: number; oi: number }[];
}

/** Read side of the real panel — the exact props ReportWorkspace passes today. */
export interface ChartDockData {
  report: NiftyReport;
  bursts: WallBurstLike[] | null;
  tape: Pick<NiftyTape, "rows"> | null;
  spotPoints: readonly SpotPoint[] | null;
  flipAt: string | null;
  maxWalls: MaxWalls | null;
  mode: NiftyReportMode;
  view: "chart" | "depth";
  symbol: string;
  asOf?: string;
  timeframe: ChartTimeframe;
  fillContainer: boolean;
}

/**
 * Reactive sources injected by the page adapter. Every field is an Accessor so
 * `data` (evaluated in the host's memo) stays live — a docked chart must track
 * the same store signals the inline panel does.
 */
export interface ReportChartSources {
  report: Accessor<NiftyReport>;
  bursts?: Accessor<WallBurstLike[] | null>;
  tape?: Accessor<Pick<NiftyTape, "rows"> | null>;
  spotPoints?: Accessor<readonly SpotPoint[] | null>;
  flipAt?: Accessor<string | null>;
  maxWalls?: Accessor<MaxWalls | null>;
  mode?: Accessor<NiftyReportMode>;
  view?: Accessor<"chart" | "depth">;
  symbol?: Accessor<string>;
  asOf?: Accessor<string | undefined>;
  timeframe?: Accessor<ChartTimeframe>;
  fillContainer?: Accessor<boolean>;
}

/**
 * The real `NiftyChartPanel` is unmodified: every prop it receives is produced
 * here from `data()`, and each command is translated to the panel's callback
 * shape. `onSizeChange` is the one type mismatch — the contract speaks in px,
 * the panel in "s"|"m"|"l"|"xl"|"fill" — so the adapter maps the preset to its
 * pixel height before firing the command.
 */
export function makeReportChartSpec(
  sources: ReportChartSources,
  commands?: DockPanelCommands,
): DockPanelSpec<ChartDockData> {
  return {
    id: "report.chart",
    page: "report",
    title: "CHART",
    size: 1,
    minWidth: 320,
    maxWidth: 420,
    singleton: true,
    requires: ["symbol"],
    data: (ctx) => ({
      report: sources.report(),
      bursts: sources.bursts?.() ?? null,
      tape: sources.tape?.() ?? null,
      spotPoints: sources.spotPoints?.() ?? null,
      flipAt: sources.flipAt?.() ?? null,
      maxWalls: sources.maxWalls?.() ?? null,
      mode: sources.mode?.() ?? "live",
      view: sources.view?.() ?? "chart",
      symbol: sources.symbol?.() ?? ctx().symbol ?? "NIFTY",
      asOf: sources.asOf?.(),
      timeframe: sources.timeframe?.() ?? "1m",
      fillContainer: sources.fillContainer?.() ?? true,
    }),
    commands,
    mount: (_ctx, api) => {
      const data = () => api.data()!;
      return (
        <NiftyChartPanel
          report={data().report}
          bursts={data().bursts}
          tape={data().tape}
          spotPoints={data().spotPoints}
          flipAt={data().flipAt}
          maxWalls={data().maxWalls}
          mode={data().mode}
          view={data().view}
          symbol={data().symbol}
          asOf={data().asOf}
          timeframe={data().timeframe}
          onTimeframeChange={(tf: ChartTimeframe) => api.commands.onTimeframeChange?.(tf)}
          // The panel reports the chosen size id (including "fill"), not pixels —
          // forwarding it verbatim keeps the command's meaning identical to the
          // page's own handler.
          onSizeChange={(size: ChartSize) => api.commands.onSizeChange?.(size)}
          // Pass the command through only when it exists: NiftyChartPanel gates
          // its expand affordance on this prop being truthy, so a wrapper
          // closure would render a button that does nothing.
          onExpand={api.commands.onExpand}
          fillContainer={data().fillContainer}
        />
      );
    },
  };
}

/** Test/page harness: mounts the real chart panel through DockHost. */
export function ReportChartDockDemo(props: {
  sources: ReportChartSources;
  commands?: DockPanelCommands;
  stacked?: boolean;
  onLayoutChange?: (layout: DockLayout) => void;
}) {
  const spec = makeReportChartSpec(props.sources, props.commands);
  const [layout, setLayout] = createSignal<DockLayout>(
    normalizeLayout({ panes: [{ id: spec.id, size: 1 }], hidden: [] }, [spec]),
  );
  const context: Accessor<DockPanelContext> = () => ({
    symbol: props.sources.symbol?.() ?? "NIFTY",
    timeframe: props.sources.timeframe?.(),
  });
  const apply = (next: DockLayout) => {
    setLayout(next);
    props.onLayoutChange?.(next);
  };
  return (
    <DockHost
      specs={[spec]}
      layout={layout()}
      context={context}
      onLayoutChange={apply}
      stacked={props.stacked}
    />
  );
}

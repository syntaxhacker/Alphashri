import { createComponent, type JSX } from "solid-js";
import { cascadeRect, type CanvasSize } from "../../components/window/layout";
import { lazyPanelSpec } from "../../components/window/panels/lazyPanel";
import type { DockPanelSpec } from "../../components/dock/types";
import type { WindowState } from "../../components/window/types";
import {
  REPORT_PANEL_TITLES,
  REPORT_WINDOW_KEYS,
  reportNeedsStore,
  type ReportWindowKey,
  type ReportWindowContext,
} from "./reportWindowTypes";
import {
  ReportChartWindow,
  ReportFlowWindow,
  ReportMoversWindow,
  ReportWallsWindow,
} from "./reportWindowDeskContent";
import {
  ReportAnalyticsWindow,
  ReportChainWindow,
} from "./reportWindowMarketContent";

/**
 * Report-specific desk registry. The six keys are the window `type` values the
 * layout, the picker and the presets all use. Chain and analytics reuse the
 * window registry's self-contained panels; chart/walls/flow/movers defer to a
 * fallback that names the report-store dependency, which the shell supplies
 * through `ReportWindowContext.reportStore`.
 */
const META: Record<ReportWindowKey, Omit<DockPanelSpec, "mount">> = {
  chart: {
    id: "chart",
    page: "report",
    title: REPORT_PANEL_TITLES.chart,
    size: 1.6,
    minWidth: 480,
    singleton: true,
    requires: [],
  },
  chain: {
    id: "chain",
    page: "report",
    title: REPORT_PANEL_TITLES.chain,
    size: 1,
    minWidth: 360,
    singleton: true,
    requires: [],
  },
  walls: {
    id: "walls",
    page: "report",
    title: REPORT_PANEL_TITLES.walls,
    size: 1,
    minWidth: 320,
    singleton: true,
    requires: [],
  },
  flow: {
    id: "flow",
    page: "report",
    title: REPORT_PANEL_TITLES.flow,
    size: 1,
    minWidth: 360,
    singleton: true,
    requires: [],
  },
  analytics: {
    id: "analytics",
    page: "report",
    title: REPORT_PANEL_TITLES.analytics,
    size: 1,
    minWidth: 420,
    singleton: true,
    requires: [],
  },
  movers: {
    id: "movers",
    page: "report",
    title: REPORT_PANEL_TITLES.movers,
    size: 1,
    minWidth: 320,
    singleton: true,
    requires: [],
  },
};

type LivePanel = (props: {
  context: ReportWindowContext;
  api: Parameters<DockPanelSpec["mount"]>[1];
}) => JSX.Element;

const LIVE_PANEL: Record<ReportWindowKey, LivePanel> = {
  chart: ReportChartWindow,
  chain: ReportChainWindow,
  walls: ReportWallsWindow,
  flow: ReportFlowWindow,
  analytics: ReportAnalyticsWindow,
  movers: ReportMoversWindow,
};

/** Metadata stays synchronous; the component graph loads on first mount. */
function specFor(key: ReportWindowKey): DockPanelSpec {
  const meta = META[key];
  const Panel = LIVE_PANEL[key];
  return lazyPanelSpec(meta, async () => ({
    ...meta,
    // Getter keeps the injected report store live if the shell updates context.
    mount: (ctx, api) =>
      createComponent(Panel, {
        get context() {
          return ctx() as ReportWindowContext;
        },
        api,
      }),
  }));
}

export const REPORT_WINDOW_PANELS: DockPanelSpec[] = REPORT_WINDOW_KEYS.map(specFor);
export const REPORT_WINDOW_TYPES: string[] = [...REPORT_WINDOW_KEYS];

const BY_KEY = new Map(REPORT_WINDOW_PANELS.map((spec) => [spec.id, spec]));

export function getReportPanelSpec(id: string): DockPanelSpec | undefined {
  return BY_KEY.get(id);
}

export function reportPanelNeedsStore(id: string): boolean {
  return (
    id in REPORT_PANEL_TITLES &&
    reportNeedsStore(id as ReportWindowKey)
  );
}

/** Deterministic id so a restored layout can be reasoned about in tests. */
export function createReportWindowFor(
  type: string,
  ordinal = 1,
  canvas: CanvasSize = { w: 1280, h: 800 },
  maxZ = 0,
): WindowState {
  const spec = getReportPanelSpec(type);
  return {
    id: `${type}-${ordinal}`,
    type,
    title: spec?.title ?? type,
    ...cascadeRect(ordinal - 1, canvas),
    z: maxZ + 1,
    minimized: false,
    maximized: false,
  };
}

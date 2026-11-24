// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSignal } from "solid-js";
import { TYPE_CLASS, UIProvider } from "@/ui";
import { REPORT_FONT } from "./reportTokens";
import { REPORT_STORE_PANEL_KEYS, REPORT_WINDOW_KEYS } from "./reportWindowTypes";

// The shell is a section-order contract here: every heavy section is stubbed
// so the test only sees the order the desk reader meets them in.
const [report, setReport] = createSignal<Record<string, unknown> | null>(null);
const [focus, setFocus] = createSignal(false);
const [desk, setDesk] = createSignal(false);
const [view, setView] = createSignal<"monitor" | "desk">("monitor");

// The windowed desk mounts the real report panel adapters, so the mock must
// answer every accessor they read — not just the ones the monitor shell uses.
const mockStore = {
  data: {
    error: () => null,
    refresh: async () => {},
    report,
    loading: () => false,
    booted: () => true,
    tapeRows: () => [],
    effectiveBursts: () => [],
    tape: () => null,
    oiPoints: () => [],
    flipAt: () => null,
    visibleStrikes: () => [],
    atmStrike: () => null,
    oiScale: () => ({ maxCeOiChange: 0, maxPeOiChange: 0 }),
    oiWalls: () => ({ calls: [], puts: [] }),
  },
  // #197's shell reads these three; they were absent from #195's mock, so the
  // shell threw while resolving the replay label before any section painted.
  ui: {
    isDesk: desk,
    isWindowDesk: () => view() === "desk",
    reportView: view,
    setReportView: setView,
    handleReportViewChange: (value: string) => setView(value === "desk" ? "desk" : "monitor"),
    view: () => "chart",
    chartTf: () => "1m",
    chartSize: () => "fill",
    handleChartTf: () => {},
    handleChartSize: () => {},
    openChartFull: () => {},
    deskOpen: () => false,
    setDeskOpen: () => {},
    openMovers: () => {},
    overlayOpen: () => focus(),
    setOverlayOpen: (_key: string, next: boolean) => setFocus(next),
  },
  walls: {
    data: () => null,
    openDrawer: () => {},
  },
  replay: { frameT: () => undefined },
  selection: { mode: () => "live", symbol: () => "NIFTY", index: () => "nifty" },
};

vi.mock("./ReportContext", () => ({
  ReportProvider: (props: { children?: unknown }) => props.children,
  useNiftyReport: () => mockStore,
}));
vi.mock("./ReportToolbar", () => ({
  ReportToolbar: (props: { presetId?: string; onPresetChange?: (id: string) => void }) => (
    <div data-testid="toolbar-stub">
      <div data-testid="nifty-report-view-toggle" role="group" aria-label="Report view">
        <button
          type="button"
          data-testid="nifty-report-view-monitor"
          aria-pressed={view() === "monitor"}
          onClick={() => mockStore.ui.handleReportViewChange("monitor")}
        >
          MONITOR
        </button>
        <button
          type="button"
          data-testid="nifty-report-view-desk"
          aria-pressed={view() === "desk"}
          onClick={() => mockStore.ui.handleReportViewChange("desk")}
        >
          DESK
        </button>
      </div>
      <select
        data-testid="nifty-report-preset-select"
        aria-label="Report layout preset"
        value={props.presetId ?? ""}
        onChange={(event) => props.onPresetChange?.(event.currentTarget.value)}
      >
        <option value="focus">Focus</option>
        <option value="desk">Desk</option>
        <option value="flow">Flow</option>
        <option value="full">Full desk</option>
      </select>
    </div>
  ),
}));
vi.mock("./ReportKpiHero", () => ({
  ReportKpiHero: () => <div data-testid="nifty-kpi-hero" data-report-section="true" />,
}));
// Mirror the real facade's sibling shape: the stat strip followed by its tail
// sections. A single decision stub would hide the default-order siblings that
// used to paint above the hero and chart.
vi.mock("./ReportDecisionStrip", () => ({
  ReportDecisionStrip: () => (
    <>
      <div data-testid="nifty-stat-strip" data-report-section="true">
        <div data-testid="decision-stub"><button type="button" data-testid="decision-focus" /></div>
      </div>
      <div data-testid="nifty-flow-windows-disclosure" data-open="false">
        <div data-testid="nifty-flow-windows" />
      </div>
      <div data-testid="movers-strip" />
      <div data-testid="nifty-context-rail" />
      <div data-testid="nifty-setup-radar" />
    </>
  ),
}));
vi.mock("./ReportStrips", () => ({
  ReportStrips: () => <div data-testid="strips-stub"><button type="button" data-testid="strips-focus" /></div>,
}));
vi.mock("./ReportWorkspace", () => ({
  ReportWorkspace: () => (
    <div data-testid="workspace-stub">
      <div data-testid="nifty-chart-panel" />
      <button type="button" data-testid="workspace-focus" />
    </div>
  ),
}));
vi.mock("./ReportAnalytics", () => ({
  ReportAnalytics: () => <div data-testid="analytics-stub"><button type="button" data-testid="analytics-focus" /></div>,
}));
vi.mock("./ReportOverlays", () => ({ ReportOverlays: () => null }));
vi.mock("./NiftyFuturesPanel", () => ({
  NiftyFuturesPanel: () => <div data-testid="futures-stub"><button type="button" data-testid="flow-focus" /></div>,
}));
vi.mock("./NiftyItmPeFlow", () => ({
  NiftyItmPeFlowPanel: () => <div data-testid="itm-stub" />,
}));

const { NiftyReportShell } = await import("./NiftyReportShell");

function mount() {
  return render(() => (
    <UIProvider>
      <NiftyReportShell />
    </UIProvider>
  ));
}

function sectionOrder(): string[] {
  const root = screen.getByTestId("nifty-report-panel");
  return Array.from(root.querySelectorAll("[data-testid]"))
    .map((el) => el.getAttribute("data-testid") ?? "")
    .filter((id) =>
      ["decision-stub", "workspace-stub", "strips-stub", "analytics-stub"].includes(id),
    );
}

/** Read the phone `order` slot a band gets, whether the rule lives on the
 *  content ancestor (shell-owned) or on the band's own class. */
function mobileOrder(cls: string, testId: string): number | null {
  if (testId === "nifty-flow-windows-disclosure") {
    const wrapper = /:has\(\[data-testid='nifty-flow-windows'\]\)\]:order-(\d+)/.exec(cls);
    return wrapper ? Number(wrapper[1]) : null;
  }
  const shell =
    new RegExp(`\\[&_\\[data-testid='${testId}'\\]\\]:max-\\[600px\\]:order-(\\d+)`).exec(cls) ??
    new RegExp(`max-\\[600px\\]:\\[&_\\[data-testid='${testId}'\\]\\]:order-(\\d+)`).exec(cls);
  if (shell) return Number(shell[1]);
  const self = /(?:^|\s)max-\[600px\]:order-(\d+)(?=\s|$)/.exec(cls);
  return self ? Number(self[1]) : null;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve({ chain: [], expiries: [], rows: [], sectors: [] }),
      text: () => Promise.resolve("{}"),
    }) as unknown as Response),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setReport(null);
  setFocus(false);
  setDesk(false);
  setView("monitor");
});

describe("NiftyReportShell section order", () => {
  test("decision → chart → flow → strips → analytics", async () => {
    setReport({
      spot: 25_980,
      futures: { series: [], regime: "neutral" },
      itm_pe_flow: { series: [], top: [] },
    });
    mount();

    await screen.findByTestId("workspace-stub");
    expect(sectionOrder()).toEqual([
      "decision-stub",
      "workspace-stub",
      "strips-stub",
      "analytics-stub",
    ]);
  });

  test("mobile section DOM order is the focus sequence (WCAG 1.3.2 / 2.4.3)", async () => {
    setReport({
      spot: 25_980,
      futures: { series: [], regime: "neutral" },
      itm_pe_flow: { series: [], top: [] },
    });
    mount();
    await screen.findByTestId("workspace-stub");

    // Tab order follows the document when nothing carries a positive tabindex:
    // assert both the section sequence and the focusable sequence in the DOM.
    expect(sectionOrder()).toEqual([
      "decision-stub",
      "workspace-stub",
      "strips-stub",
      "analytics-stub",
    ]);

    const content = screen.getByTestId("nifty-report-content");
    const focusables = Array.from(
      content.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]"),
    );
    expect(
      focusables
        .map((el) => el.getAttribute("data-testid"))
        .filter((id) => id?.endsWith("-focus")),
    ).toEqual(["decision-focus", "workspace-focus", "strips-focus", "analytics-focus"]);
    for (const el of content.querySelectorAll<HTMLElement>("[tabindex]")) {
      expect(Number(el.getAttribute("tabindex"))).toBeLessThanOrEqual(0);
    }
  });

  test("the two analytics panels never render above the chart", async () => {
    setReport({
      spot: 25_980,
      futures: { series: [], regime: "neutral" },
      itm_pe_flow: { series: [], top: [] },
    });
    mount();

    await screen.findByTestId("workspace-stub");
    expect(screen.queryByTestId("nifty-flow-above-chart")).not.toBeInTheDocument();
    expect(screen.queryByTestId("futures-stub")).not.toBeInTheDocument();
    expect(screen.queryByTestId("itm-stub")).not.toBeInTheDocument();
  });

  test("the shell leaves the single decision band to the strip", async () => {
    setReport({ spot: 25_980 });
    mount();

    await screen.findByTestId("workspace-stub");
    expect(screen.queryByTestId("nifty-kpi-hero")).not.toBeInTheDocument();
    expect(screen.getByTestId("decision-stub")).toBeInTheDocument();
  });

  test("the chart focus state is a data attribute on the shell, not an unmount", async () => {
    setReport({ spot: 25_980 });
    mount();

    const panel = screen.getByTestId("nifty-report-panel");
    expect(panel).toHaveAttribute("data-chart-focus", "false");
    setFocus(true);
    expect(panel).toHaveAttribute("data-chart-focus", "true");
    expect(screen.getByTestId("nifty-chart-focus-exit")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-stub")).toBeInTheDocument();
    setFocus(false);
    expect(panel).toHaveAttribute("data-chart-focus", "false");
  });

  test("clicking the chart plot does not open chart focus", async () => {
    setReport({ spot: 25_980 });
    mount();

    const panel = await screen.findByTestId("nifty-report-panel");
    const chart = await screen.findByTestId("nifty-chart-panel");
    expect(panel).toHaveAttribute("data-chart-focus", "false");
    fireEvent.click(chart);
    expect(panel).toHaveAttribute("data-chart-focus", "false");
    expect(screen.queryByTestId("nifty-chart-focus-exit")).not.toBeInTheDocument();
  });

  test("the report content is the single scroll owner in desk mode", async () => {
    setDesk(true);
    setReport({ spot: 25_980 });
    try {
      mount();

      const content = screen.getByTestId("nifty-report-content");
      expect(content.className).toContain("overflow-y-auto");
      expect(content.style.overflowY).toBe("auto");
      expect(content.className).toContain("overflow-x-hidden");
      expect(content.style.overflowX).toBe("hidden");
      // The collapsed walls rail sits in a content-sized bottom track, so the
      // chart row absorbs the slack instead of leaving a dead band above the dock.
      expect(content.className).toContain("min-[1200px]:grid-rows-[auto_minmax(0,1fr)_auto]");
      expect(content.className).not.toContain("minmax(0,30fr)");
      expect(screen.getByTestId("nifty-report-panel").style.overflow).toBe("hidden");
    } finally {
      setDesk(false);
    }
  });
});

describe("NiftyReportShell workspace switch", () => {
  test("the chart-first monitor is the default and DESK swaps in the windowed workspace", async () => {
    setReport({
      spot: 25_980,
      futures: { series: [], regime: "neutral" },
      itm_pe_flow: { series: [], top: [] },
    });
    mount();
    await screen.findByTestId("workspace-stub");

    expect(screen.getByTestId("nifty-report-view-monitor")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("nifty-report-view-desk")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("report-window-desk")).not.toBeInTheDocument();
    expect(screen.getByTestId("nifty-report-content")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("nifty-report-view-desk"));
    expect(screen.getByTestId("nifty-report-view-desk")).toHaveAttribute("aria-pressed", "true");
    const desk = await screen.findByTestId("report-window-desk");
    expect(desk).toBeInTheDocument();
    expect(screen.getByTestId("window-manager-canvas")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-report-content")).not.toBeInTheDocument();

    // The first desk visit opens all six registered report panels. Preset ids
    // are `${type}-${ordinal}`, so match by the registry-owned type prefix.
    for (const key of REPORT_WINDOW_KEYS) {
      expect(await screen.findByTestId(new RegExp(`^window-${key}-\\d+$`))).toBeInTheDocument();
    }
    expect(screen.getAllByRole("region")).toHaveLength(REPORT_WINDOW_KEYS.length);

    fireEvent.click(screen.getByTestId("nifty-report-view-monitor"));
    expect(screen.queryByTestId("report-window-desk")).not.toBeInTheDocument();
    expect(screen.getByTestId("nifty-report-content")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-stub")).toBeInTheDocument();
  });

  test("the shell injects the live report store into store-dependent window panels", async () => {
    // A closed session parks the movers adapter on its named empty state
    // instead of polling a live endpoint; the reason still proves the store
    // reached the adapter rather than its no-store fallback.
    setReport({ spot: 25_980, market: { is_open: false } });
    mount();
    fireEvent.click(screen.getByTestId("nifty-report-view-desk"));

    const realContent: Record<(typeof REPORT_STORE_PANEL_KEYS)[number], string> = {
      chart: "nifty-chart-panel",
      walls: "walls-empty",
      flow: "flow-empty",
      movers: "movers-empty",
    };
    for (const key of REPORT_STORE_PANEL_KEYS) {
      const windowBody = await screen.findByTestId(`report-${key}-window`);
      expect(windowBody, key).toBeInTheDocument();
      expect(await screen.findByTestId(realContent[key]), key).toBeInTheDocument();
      expect(windowBody, key).not.toHaveTextContent(/Report store not connected/i);
    }
    // Standalone panels own their data path: real windows with their own named
    // empty states, never the report-store dependency placeholder.
    for (const key of ["chain", "analytics"]) {
      expect(await screen.findByTestId(`report-${key}-window`)).toBeInTheDocument();
      expect(screen.getByTestId(`report-${key}-window-empty`)).toBeInTheDocument();
    }
  });

  test("an emptied desk is honored and paints the report-window empty state", async () => {
    setReport({ spot: 25_980 });
    mount();
    fireEvent.click(screen.getByTestId("nifty-report-view-desk"));
    await screen.findByTestId("window-manager-canvas");

    for (;;) {
      const close = document.querySelector<HTMLElement>('[data-testid^="window-close-"]');
      if (!close) break;
      fireEvent.click(close);
    }
    expect(await screen.findByTestId("report-window-empty")).toBeInTheDocument();
    expect(screen.getByTestId("report-window-empty")).toHaveAttribute("role", "status");
    expect(screen.queryAllByRole("region")).toHaveLength(0);
  });

  test("the preset picker resolves geometry through the shell before the desk consumes it", async () => {
    setReport({ spot: 25_980 });
    mount();
    fireEvent.click(screen.getByTestId("nifty-report-view-desk"));
    await screen.findByTestId("window-manager-canvas");

    const picker = screen.getByTestId("nifty-report-preset-select") as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: "focus" } });

    expect(screen.getAllByRole("region")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "INDEX CHART" })).toBeInTheDocument();
    expect(picker).toHaveValue("focus");
  });
});

describe("NiftyReportShell KPI strip at 390", () => {
  test("panel carries clip-safe overrides for the stat strip below 600px", async () => {
    setReport({ spot: 25_980 });
    mount();

    const panel = screen.getByTestId("nifty-report-panel");
    const cls = panel.className;
    // Groups stack, so 1600-tuned per-cell minimums no longer overflow 390.
    expect(cls).toContain("max-[600px]:[&_[data-testid='nifty-decision-stats']]:flex-col");
    expect(cls).toContain("max-[600px]:[&_[data-testid='nifty-decision-stats']>*]:min-w-full!");
    // Two cells per row, each wide enough for a full 16px mono figure.
    expect(cls).toContain("basis-[calc(50%_-_2px)]!");
    expect(cls).toContain(":last-child>*]:min-w-0!");
    // No mid-number ellipsis: a clipped price is a wrong price.
    expect(cls).toContain("max-[600px]:[&_[data-testid$='-value']]:text-clip!");
    expect(cls).toContain("max-[600px]:[&_[data-testid$='-value']]:overflow-visible!");
  });

  test("the hero stays a single row at 390 so its popover cannot shift the chart", async () => {
    setReport({ spot: 25_980 });
    mount();

    const cls = screen.getByTestId("nifty-report-panel").className;
    expect(cls).toContain("max-[600px]:[&_[data-testid='nifty-kpi-hero']]:flex-nowrap!");
    expect(cls).toContain("max-[600px]:[&_[data-testid='nifty-kpi-hero']]:overflow-visible!");
    // The shell never forces the strip's own disclosure open or closed.
    expect(cls).not.toContain("nifty-verdict-disclosure']_[data-testid='nifty-live-tape-content']");
  });

  test("desktop strip layout is untouched (overrides are max-width gated)", async () => {
    setReport({ spot: 25_980 });
    mount();

    const panel = screen.getByTestId("nifty-report-panel");
    const narrowRules = panel.className.split(" ").filter((c) => c.includes("max-[600px]"));
    expect(narrowRules.length).toBeGreaterThan(0);
    for (const rule of narrowRules) expect(rule).toContain("max-[600px]:");
  });
});

describe("NiftyReportShell shared-scale contract", () => {
  test("the replay banner uses the shared type floor, not the legacy 11px step", async () => {
    setReport({ spot: 25_980 });
    const liveMode = mockStore.selection.mode;
    mockStore.selection.mode = () => "eod";
    try {
      mount();
      const banner = await screen.findByTestId("nifty-replay-mode-banner");
      expect(banner.className).toContain(TYPE_CLASS.micro);
      expect(banner.className).not.toContain("text-[11px]");
    } finally {
      mockStore.selection.mode = liveMode;
    }
  });

  test("shell radii come from the terminal vocabulary, never an arbitrary 8/12", () => {
    const source = readFileSync(
      join(process.cwd(), "src/pages/report/NiftyReportShell.tsx"),
      "utf8",
    );
    expect(source).toContain("REPORT_RADIUS.xs");
    expect(source).not.toContain('"border-radius": "8px"');
    expect(source).not.toContain('"border-radius": "12px"');
  });
});

describe("NiftyReportShell 390 composition", () => {
  test("the toolbar hand-off is the only shell-owned chrome and cannot clip the control strip", async () => {
    setReport({ spot: 25_980 });
    mount();
    await screen.findByTestId("workspace-stub");

    const chrome = screen.getByTestId("toolbar-stub").closest("[data-report-section]") as HTMLElement;
    expect(chrome).toHaveAttribute("id", "nifty-report-chrome");
    expect(chrome).toHaveAttribute("data-compact-chrome", "true");
    expect(chrome.className).toContain("pb-2");
    expect(chrome.className).toContain("max-[600px]:pb-1!");
    // The toolbar owns its own primary row / overflow cue; the shell must not
    // put an overflow-hidden ancestor in front of its horizontal scroller.
    expect(chrome.className).toContain("max-[600px]:overflow-visible!");

    const panel = screen.getByTestId("nifty-report-panel");
    expect(panel.className).toContain("max-[600px]:[&_[data-testid='nifty-report-content']]:pt-1!");
    expect(panel.className).toContain("max-[600px]:[&_[data-testid='nifty-report-content']]:gap-1!");
  });

  test("the shell leaves the decision strip's primary call and disclosures alone", async () => {
    setReport({ spot: 25_980 });
    mount();
    await screen.findByTestId("workspace-stub");

    const cls = screen.getByTestId("nifty-report-panel").className;
    // The decision strip renders the default-visible hero verdict; the shell
    // must not force its secondary "MORE STATS" disclosure open, hide its
    // toggle, or duplicate the call in another band.
    expect(cls).not.toContain("nifty-verdict-disclosure']_[data-testid='nifty-live-tape-content']]:flex!");
    expect(cls).not.toContain("nifty-verdict-disclosure']_[data-testid='nifty-live-tape-toggle']]:hidden!");
    expect(cls).not.toContain("nifty-flow-windows-disclosure']_[data-testid='nifty-live-tape-content']]:flex!");
  });

  test("the dashboard ladder is 16px titles, 13px values, 12px labels with 4/8 gutters", async () => {
    setReport({ spot: 25_980 });
    mount();
    await screen.findByTestId("workspace-stub");

    const cls = screen.getByTestId("nifty-report-panel").className;
    expect(cls).toContain("nifty-decision-stats']_[data-testid$='-label']]:text-ui-title!");
    expect(cls).toContain("nifty-decision-stats']_[data-testid$='-value']]:text-ui-body!");
    expect(cls).toContain("]>*>*:first-child]:text-ui-micro!");
    expect(cls).toContain("nifty-decision-stats']]:gap-2!");
    expect(cls).toContain("nifty-decision-stats']_[data-testid$='-cells']]:gap-1!");
  });

  test("DOM order is hero → decision → chart → strips → analytics (mobile reading order)", async () => {
    setReport({
      spot: 25_980,
      futures: { series: [], regime: "neutral" },
      itm_pe_flow: { series: [], top: [] },
    });
    mount();
    await screen.findByTestId("workspace-stub");

    expect(sectionOrder()).toEqual([
      "decision-stub",
      "workspace-stub",
      "strips-stub",
      "analytics-stub",
    ]);

    const contentCls = screen.getByTestId("nifty-report-content").className;
    // Phone paint slots still match the DOM; the desk overrides are negative
    // orders so the 1600 grid placement is unchanged.
    expect(contentCls).toContain("nifty-stat-strip']]:order-1");
    expect(contentCls).toContain("nifty-main-row']]:order-2");
    expect(contentCls).toContain("nifty-stat-strip']]:-order-3");
    expect(screen.queryByTestId("nifty-kpi-hero")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-flow-above-chart")).not.toBeInTheDocument();
  });
});

describe("NiftyReportShell 390 visual order (including decision tail)", () => {
  function mountFull() {
    setReport({
      spot: 25_980,
      futures: { series: [], regime: "neutral" },
      itm_pe_flow: { series: [], top: [] },
    });
    mount();
  }

  test("every content band owns one unique slot: chart → dock/tail → strips → analytics", async () => {
    mountFull();
    await screen.findByTestId("workspace-stub");

    const content = screen.getByTestId("nifty-report-content").className;
    const slots: Array<[string, number | null]> = [
      ["nifty-stat-strip", mobileOrder(content, "nifty-stat-strip")],
      ["nifty-main-row", mobileOrder(content, "nifty-main-row")],
      ["desk-dock-region", mobileOrder(content, "desk-dock-region")],
      ["nifty-flow-windows-disclosure", mobileOrder(content, "nifty-flow-windows-disclosure")],
      ["movers-strip", mobileOrder(content, "movers-strip")],
      ["nifty-context-rail", mobileOrder(content, "nifty-context-rail")],
      ["nifty-setup-radar", mobileOrder(content, "nifty-setup-radar")],
      ["nifty-report-strips", mobileOrder(content, "nifty-report-strips")],
      ["nifty-analytics-row", mobileOrder(content, "nifty-analytics-row")],
      ["nifty-iv-skew-row", mobileOrder(content, "nifty-iv-skew-row")],
    ];
    expect(slots.map(([, order]) => order)).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10, 11]);
    expect(new Set(slots.map(([, order]) => order)).size).toBe(slots.length);
  });

  test("the decision tail no longer paints above the hero or chart", async () => {
    mountFull();
    await screen.findByTestId("workspace-stub");

    const content = screen.getByTestId("nifty-report-content").className;
    const chartOrder = mobileOrder(content, "nifty-main-row")!;
    for (const id of [
      "nifty-flow-windows-disclosure",
      "movers-strip",
      "nifty-context-rail",
      "nifty-setup-radar",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
      expect(mobileOrder(content, id), `${id} still default-orders above the chart`).toBeGreaterThan(
        chartOrder,
      );
    }
    // The only full bands ahead of the chart are the toolbar chrome and the
    // hero; no unavailable band is allowed a slot at or before the chart.
    for (const id of ["desk-dock-region", "movers-strip", "nifty-flow-windows-disclosure"]) {
      expect(mobileOrder(content, id)).toBeGreaterThan(mobileOrder(content, "nifty-stat-strip")!);
    }
  });

  test("no unavailable full band or wrapped dock row spends the first viewport", async () => {
    mountFull();
    await screen.findByTestId("workspace-stub");

    const content = screen.getByTestId("nifty-report-content").className;
    expect(content).toContain(
      "max-[600px]:[&_[data-testid='movers-strip']:not([data-report-spacing])]:hidden!",
    );
    expect(content).toContain("max-[600px]:[&_[data-testid='desk-dock']]:flex-nowrap!");
    expect(content).toContain("max-[600px]:[&_[data-testid='desk-dock']]:overflow-x-auto!");
  });

  test("focus follows the unchanged DOM sequence; no positive tabindex shortcut", async () => {
    mountFull();
    await screen.findByTestId("workspace-stub");

    const panel = screen.getByTestId("nifty-report-panel");
    const positive = Array.from(panel.querySelectorAll("[tabindex]")).filter(
      (el) => Number(el.getAttribute("tabindex")) > 0,
    );
    expect(positive).toEqual([]);

    const ids = Array.from(panel.querySelectorAll("[data-testid]")).map(
      (el) => el.getAttribute("data-testid") ?? "",
    );
    expect(ids.indexOf("decision-stub")).toBeLessThan(
      ids.indexOf("nifty-flow-windows-disclosure"),
    );
    expect(ids.indexOf("nifty-flow-windows-disclosure")).toBeLessThan(ids.indexOf("movers-strip"));
    expect(ids.indexOf("movers-strip")).toBeLessThan(ids.indexOf("nifty-context-rail"));
    expect(ids.indexOf("nifty-context-rail")).toBeLessThan(ids.indexOf("workspace-stub"));
  });
});

describe("NiftyReportShell spacing rhythm", () => {
  test("toolbar, replay band and KPI hero use deliberate 8/12 spacings", async () => {
    setReport({
      spot: 25_980,
      futures: { series: [], regime: "neutral" },
      itm_pe_flow: { series: [], top: [] },
    });
    const liveMode = mockStore.selection.mode;
    mockStore.selection.mode = () => "eod";
    try {
      mount();

      const toolbarWrap = screen
        .getByTestId("toolbar-stub")
        .closest("[data-report-section]") as HTMLElement;
      expect(toolbarWrap.className).toContain("pb-2"); // 8px below the toolbar hairline

      const banner = screen.getByTestId("nifty-replay-mode-banner");
      expect(banner.className).toContain("px-3");
      expect(banner.className).toContain("gap-x-2");
      expect(banner.style.height).toBe("24px");

      expect(screen.queryByTestId("nifty-kpi-hero")).not.toBeInTheDocument();
      expect(screen.queryByTestId("nifty-flow-above-chart")).not.toBeInTheDocument();
    } finally {
      mockStore.selection.mode = liveMode;
    }
  });

  test("the replay band is a 16px title over a 12px note, not equal-weight micro text", async () => {
    setReport({ spot: 25_980 });
    const liveMode = mockStore.selection.mode;
    mockStore.selection.mode = () => "eod";
    try {
      mount();
      const banner = screen.getByTestId("nifty-replay-mode-banner");
      const [title, note] = Array.from(banner.children) as HTMLElement[];
      expect(title.style.fontSize).toBe(`${REPORT_FONT.value}px`);
      expect(title.style.fontWeight).toBe("800");
      expect(note.style.fontSize).toBe(`${REPORT_FONT.micro}px`);
      expect(note.style.color).not.toBe(title.style.color);
    } finally {
      mockStore.selection.mode = liveMode;
    }
  });

  test("the replay strip is 24px with time and one active note, no empty placeholders", async () => {
    setReport({ spot: 25_980 });
    const liveMode = mockStore.selection.mode;
    mockStore.selection.mode = () => "eod";
    try {
      mount();
      const banner = screen.getByTestId("nifty-replay-mode-banner");
      expect(banner.style.height).toBe("24px");
      expect(banner.style.minHeight).toBe("24px");
      expect(banner.textContent).not.toContain("Not captured in replay");
      expect(banner.children).toHaveLength(2);
      expect(banner.textContent).toMatch(/REPLAY/);
    } finally {
      mockStore.selection.mode = liveMode;
    }
  });

  test("the shell does not paint a second KPI hero above the strip", async () => {
    setReport({ spot: 25_980 });
    mount();
    await screen.findByTestId("workspace-stub");
    expect(screen.queryByTestId("nifty-kpi-hero")).not.toBeInTheDocument();
  });
});

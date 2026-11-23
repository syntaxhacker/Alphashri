// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSignal } from "solid-js";
import { UIProvider } from "@/ui";
import { REPORT_FONT } from "./reportTokens";

// The shell is a section-order contract here: every heavy section is stubbed
// so the test only sees the order the desk reader meets them in.
const [report, setReport] = createSignal<Record<string, unknown> | null>(null);

const mockStore = {
  data: {
    error: () => null,
    refresh: async () => {},
    report,
    loading: () => false,
    booted: () => true,
  },
  // #197's shell reads these three; they were absent from #195's mock, so the
  // shell threw while resolving the replay label before any section painted.
  ui: { isDesk: () => false },
  replay: { frameT: () => undefined },
  selection: { mode: () => "live" },
};

vi.mock("./ReportContext", () => ({
  ReportProvider: (props: { children?: unknown }) => props.children,
  useNiftyReport: () => mockStore,
}));
vi.mock("./ReportToolbar", () => ({ ReportToolbar: () => <div data-testid="toolbar-stub" /> }));
vi.mock("./ReportDecisionStrip", () => ({
  ReportDecisionStrip: () => <div data-testid="decision-stub" />,
}));
vi.mock("./ReportStrips", () => ({ ReportStrips: () => <div data-testid="strips-stub" /> }));
vi.mock("./ReportWorkspace", () => ({
  ReportWorkspace: () => <div data-testid="workspace-stub" />,
}));
vi.mock("./ReportAnalytics", () => ({
  ReportAnalytics: () => <div data-testid="analytics-stub" />,
}));
vi.mock("./ReportOverlays", () => ({ ReportOverlays: () => null }));
vi.mock("./NiftyFuturesPanel", () => ({
  NiftyFuturesPanel: () => <div data-testid="futures-stub" />,
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
      ["decision-stub", "nifty-flow-above-chart", "workspace-stub", "strips-stub", "analytics-stub"].includes(
        id,
      ),
    );
}

afterEach(() => {
  cleanup();
  setReport(null);
});

describe("NiftyReportShell section order", () => {
  test("decision → flow → chart → strips → analytics", async () => {
    setReport({
      spot: 25_980,
      futures: { series: [], regime: "neutral" },
      itm_pe_flow: { series: [], top: [] },
    });
    mount();

    await screen.findByTestId("workspace-stub");
    expect(sectionOrder()).toEqual([
      "decision-stub",
      "nifty-flow-above-chart",
      "workspace-stub",
      "strips-stub",
      "analytics-stub",
    ]);
  });

  test("the flow row is absent when neither block was recorded", async () => {
    setReport({ spot: 25_980 });
    mount();

    await screen.findByTestId("workspace-stub");
    expect(screen.queryByTestId("nifty-flow-above-chart")).not.toBeInTheDocument();
    expect(sectionOrder()).toEqual([
      "decision-stub",
      "workspace-stub",
      "strips-stub",
      "analytics-stub",
    ]);
  });

  test("one recorded block renders alone, without a dead column", async () => {
    setReport({ spot: 25_980, futures: { series: [], regime: "neutral" } });
    mount();

    const row = await screen.findByTestId("nifty-flow-above-chart");
    expect(screen.getByTestId("futures-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("itm-stub")).not.toBeInTheDocument();
    expect(row.className).toContain("grid-cols-1");
    expect(row.className).not.toContain("min-[1200px]:grid-cols-2");
  });

  test("both blocks stack at 390 and sit side by side from 1200", async () => {
    setReport({
      spot: 25_980,
      futures: { series: [], regime: "neutral" },
      itm_pe_flow: { series: [], top: [] },
    });
    mount();

    const row = await screen.findByTestId("nifty-flow-above-chart");
    expect(row.className).toContain("grid-cols-1");
    expect(row.className).toContain("min-[1200px]:grid-cols-2");
    expect(row.className).toContain("min-w-0");
    expect(row.querySelectorAll(":scope > [data-testid]")).toHaveLength(2);
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
    // Two cells per row, each wide enough for a full 17px mono figure.
    expect(cls).toContain("basis-[calc(50%_-_2px)]!");
    expect(cls).toContain(":last-child>*]:min-w-0!");
    // No mid-number ellipsis: a clipped price is a wrong price.
    expect(cls).toContain("max-[600px]:[&_[data-testid$='-value']]:text-clip!");
    expect(cls).toContain("max-[600px]:[&_[data-testid$='-value']]:overflow-visible!");
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
      expect(banner.className).toContain(`text-[${REPORT_FONT.micro}px]`);
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

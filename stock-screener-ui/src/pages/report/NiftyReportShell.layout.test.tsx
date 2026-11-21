// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { UIProvider } from "@/ui";

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

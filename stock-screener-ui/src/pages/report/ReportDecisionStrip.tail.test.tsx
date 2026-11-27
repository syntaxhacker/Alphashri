// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { NiftyReport } from "@/types/niftyReport";
import { fetchIndexMovers, type IndexMoversResponse } from "@/api/indexMovers";

vi.mock("@/api/indexMovers", () => ({ fetchIndexMovers: vi.fn() }));
vi.mock("./ReportDecisionStrip.hero", () => ({
  RailClaim: () => null,
  TapeBadgeControl: () => null,
}));
vi.mock("./NiftyIntelStrip", () => ({ NiftyIntelStrip: () => null }));
vi.mock("./NiftyGammaStrip", () => ({ NiftyGammaStrip: () => null }));
vi.mock("./SetupRadarStrip", () => ({ SetupRadarStrip: () => null }));

import {
  flowWindowsBandAvailable,
  FlowWindowsSection,
  MoversSection,
} from "./ReportDecisionStrip.tail";

const mockFetch = vi.mocked(fetchIndexMovers);
let mobile = false;

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: mobile && query.includes("max-width: 600px"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

beforeEach(() => {
  mobile = false;
  mockFetch.mockReset();
});

afterEach(cleanup);

function report(over: Partial<NiftyReport> = {}): NiftyReport {
  return {
    date: "2026-11-23",
    spot: 25_000,
    strikes: [],
    control: { verdict: null, flow_bias: null },
    flow_window: null,
    market: { is_open: true },
    ...over,
  } as NiftyReport;
}

const flowReport = report({
  control: { verdict: "call_buyers", flow_bias: 2656.63 },
  flow_window: {
    as_of: "2026-11-23T11:25:14+05:30",
    "15m": { from: "", ce: 1_000, pe: -500, net: 1_500 },
    "5m": { from: "", ce: 300, pe: -200, net: 500 },
  },
});

const moversData = (): IndexMoversResponse => ({
  index: "NIFTY",
  as_of: "2026-11-23T11:25:14+05:30",
  stale: false,
  source: "test",
  gainers: [{ symbol: "HDFCBANK", ltp: 1, change_pct: 1.9, contribution_pct: 0, volume: 1 }],
  losers: [{ symbol: "TCS", ltp: 1, change_pct: -2.5, contribution_pct: 0, volume: 1 }],
  live_only: false,
});

type View = Parameters<typeof FlowWindowsSection>[0]["view"];

function viewFor(flow: NiftyReport | null): View {
  return {
    flowReport: () => flow,
    narrow: () => mobile,
    lastFlip: () => null,
    symbol: () => "NIFTY",
    mode: () => "live",
    report: () => report({ market: { is_open: true } }),
    store: { ui: { openMovers: () => {} } },
  } as unknown as View;
}

function mount(flow: NiftyReport | null) {
  const view = viewFor(flow);
  return render(() => (
    <UIProvider>
      <div data-testid="harness">
        <FlowWindowsSection view={view} open={false} onToggle={() => {}} />
        <MoversSection view={view} />
      </div>
    </UIProvider>
  ));
}

const windowsSection = () =>
  screen.getByTestId("nifty-flow-windows").closest("[data-report-section]") as HTMLElement;

describe("flow window availability", () => {
  test("a null, empty or all-dash report is not a data band", () => {
    expect(flowWindowsBandAvailable(null)).toBe(false);
    expect(flowWindowsBandAvailable(undefined)).toBe(false);
    expect(flowWindowsBandAvailable(report())).toBe(false);
    expect(
      flowWindowsBandAvailable(
        report({
          flow_window: {
            as_of: "",
            "5m": { from: "", ce: NaN, pe: NaN, net: NaN },
            "15m": { from: "", ce: NaN, pe: NaN, net: NaN },
          },
        }),
      ),
    ).toBe(false);
  });

  test("a real leg or a finite session number is a data band", () => {
    expect(flowWindowsBandAvailable(flowReport)).toBe(true);
    expect(
      flowWindowsBandAvailable(report({ control: { verdict: null, flow_bias: 42 } })),
    ).toBe(true);
  });
});

describe("WINDOWS + MOVERS share one status row", () => {
  test("all empty renders exactly one 30px reason strip naming both surfaces", async () => {
    mockFetch.mockRejectedValue(new Error("MOVERS_UNAVAILABLE"));
    mount(report());

    await waitFor(() => expect(screen.getByText("unavailable")).toBeInTheDocument());
    const strips = screen.getAllByTestId("movers-strip");
    expect(strips).toHaveLength(1);
    const strip = strips[0];
    expect(strip).toHaveAttribute("data-empty", "true");
    expect(strip).toHaveAttribute("data-surfaces", "WINDOWS");
    expect(strip).toHaveTextContent(/MOVERS/);
    expect(strip).toHaveTextContent(/WINDOWS/);
    expect(strip.className).toContain("h-[30px]");
    expect(strip.className).not.toContain("flex-wrap");
    expect(screen.getAllByTestId("movers-retry")).toHaveLength(1);

    // The empty WINDOWS band keeps its testids but reserves no height.
    expect(screen.getByTestId("nifty-flow-windows")).toBeInTheDocument();
    expect(windowsSection().style.display).toBe("none");
  });

  test("partial — windows has data, movers is unavailable: one MOVERS strip", async () => {
    mockFetch.mockRejectedValue(new Error("MOVERS_UNAVAILABLE"));
    mount(flowReport);

    await waitFor(() => expect(screen.getByText("unavailable")).toBeInTheDocument());
    expect(screen.getAllByTestId("movers-strip")).toHaveLength(1);
    expect(screen.getByTestId("movers-strip")).toHaveAttribute("data-surfaces", "");
    expect(screen.getByTestId("movers-strip")).not.toHaveTextContent("WINDOWS");
    expect(screen.getAllByTestId("movers-retry")).toHaveLength(1);
    expect(windowsSection().style.display).not.toBe("none");
  });

  test("partial — movers has data, windows is empty: no reason strip", async () => {
    mockFetch.mockResolvedValue(moversData());
    mount(report());

    await waitFor(() => expect(screen.getByText("HDFCBANK")).toBeInTheDocument());
    const strip = screen.getByTestId("movers-strip");
    expect(strip).toHaveAttribute("data-report-spacing", "8");
    expect(strip).not.toHaveAttribute("data-empty");
    expect(screen.queryByText("Retry")).toBeNull();
    expect(windowsSection().style.display).toBe("none");
  });

  test("both real keeps both full-width bands and no reason strip", async () => {
    mockFetch.mockResolvedValue(moversData());
    mount(flowReport);

    await waitFor(() => expect(screen.getByText("TCS")).toBeInTheDocument());
    expect(screen.getByTestId("nifty-flow-windows")).toHaveTextContent("CALL BUYING");
    expect(windowsSection().style.display).not.toBe("none");
    expect(screen.queryByTestId("movers-retry")).toBeNull();
  });

  test("phone order stays WINDOWS disclosure then MOVERS, with one strip when empty", async () => {
    mobile = true;
    mockFetch.mockResolvedValue(moversData());
    mount(flowReport);

    const disclosure = await screen.findByTestId("nifty-flow-windows-disclosure");
    const movers = screen.getByTestId("movers-strip");
    expect(disclosure.compareDocumentPosition(movers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();

    mockFetch.mockRejectedValue(new Error("MOVERS_UNAVAILABLE"));
    mount(report());
    await waitFor(() => expect(screen.getByText("unavailable")).toBeInTheDocument());
    expect(screen.getAllByTestId("movers-strip")).toHaveLength(1);
    expect(screen.getByTestId("nifty-flow-windows-disclosure").closest("[data-report-section]")).toHaveStyle({
      display: "none",
    });
  });
});

// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { NiftyReportPanel, niftyOiColumns } from "./NiftyReportPanel";
import type { NiftyReport } from "@/types/niftyReport";

vi.mock("@/api/reportNifty", () => ({
  fetchLiveNifty: vi.fn(),
  fetchNiftyByDate: vi.fn(),
  fetchNiftyExpiries: vi.fn().mockResolvedValue([]),
  snapshotNifty: vi.fn(),
}));

vi.mock("@/components/chart/TradingViewChart", () => ({
  TradingViewChart: ({ markLines }: { markLines?: unknown[] }) => (
    <div data-testid="tradingview-chart" data-marklines={markLines?.length ?? 0} />
  ),
}));

import {
  fetchLiveNifty,
  fetchNiftyByDate,
  snapshotNifty,
} from "@/api/reportNifty";

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: TestWrapper });
}

function mockReport(overrides?: Partial<NiftyReport>): NiftyReport {
  return {
    mode: "live",
    date: "2026-10-12",
    expiry: "weekly",
    spot: 25750.5,
    ohlc: { open: 25600, high: 25800, low: 25550, close: 25750.5 },
    pcrOi: 1.12,
    pcrVol: 0.95,
    maxPain: 25700,
    walls: {
      calls: [
        { strike: 25800, oi: 5000 },
        { strike: 25900, oi: 4000 },
        { strike: 26000, oi: 3000 },
      ],
      puts: [
        { strike: 25600, oi: 6000 },
        { strike: 25500, oi: 4500 },
        { strike: 25400, oi: 3500 },
      ],
    },
    strikes: [
      {
        strike: 25700,
        ce: {
          ltp: 120, close: 110, oi: 2000, prevOi: 1800,
          oiChange: 200, priceChange: 9.09, sentiment: "Bullish",
        },
        pe: {
          ltp: 100, close: 105, oi: 2500, prevOi: 2600,
          oiChange: -100, priceChange: -4.76, sentiment: "Bearish",
        },
      },
    ],
    timeline: [{ time: "09:15", title: "Open", detail: "Nifty opened flat" }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(fetchLiveNifty).mockResolvedValue(mockReport());
  vi.mocked(fetchNiftyByDate).mockResolvedValue(mockReport({ mode: "eod" }));
  vi.mocked(snapshotNifty).mockResolvedValue(mockReport());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NiftyReportPanel toolbar", () => {
  test("renders mode toggle, expiry select, refresh and snapshot buttons", async () => {
    r(<NiftyReportPanel />);
    expect(screen.getByTestId("nifty-report-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-mode-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-expiry-select")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-refresh-button")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-snapshot-button")).toBeInTheDocument();
    // live load fires on mount
    await waitFor(() => {
      expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalled();
    });
  });

  test("live stat strip shows spot, PCR and max pain from mock", async () => {
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    });
    const strip = screen.getByTestId("nifty-stat-strip");
    expect(within(strip).getByText("25,750.5")).toBeInTheDocument();
    expect(within(strip).getByText("1.12")).toBeInTheDocument();
    expect(within(strip).getByText("0.95")).toBeInTheDocument();
    expect(within(strip).getByText("25,700")).toBeInTheDocument();
  });

  test("snapshot button calls snapshotNifty", async () => {
    const user = userEvent.setup();
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("nifty-snapshot-button"));
    await waitFor(() => {
      expect(vi.mocked(snapshotNifty)).toHaveBeenCalledWith(undefined, "");
    });
  });
});

describe("NiftyReportPanel EOD mode", () => {
  test("shows date picker and loads by date", async () => {
    const user = userEvent.setup();
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "EOD" }));
    const dateInput = screen.getByTestId("nifty-date-input");
    expect(dateInput).toBeInTheDocument();
    await user.clear(dateInput);
    await user.type(dateInput, "2026-10-10");
    await waitFor(() => {
      expect(vi.mocked(fetchNiftyByDate)).toHaveBeenCalledWith("2026-10-10");
    });
  });

  test("empty state prompts for a date when none selected", async () => {
    const user = userEvent.setup();
    // live fetch resolves empty so only the EOD empty path is exercised
    vi.mocked(fetchLiveNifty).mockResolvedValue(null as unknown as NiftyReport);
    r(<NiftyReportPanel />);
    await user.click(screen.getByRole("button", { name: "EOD" }));
    expect(await screen.findByTestId("nifty-empty")).toBeInTheDocument();
    expect(screen.getByText("Pick a date to load the EOD report.")).toBeInTheDocument();
  });
});

describe("NiftyReportPanel states", () => {
  test("error state shows alert with retry", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchLiveNifty).mockRejectedValueOnce(new Error("Backend down"));
    r(<NiftyReportPanel />);
    expect(await screen.findByTestId("nifty-error")).toBeInTheDocument();
    expect(screen.getByText("Backend down")).toBeInTheDocument();
    await user.click(screen.getByTestId("nifty-error-retry"));
    await waitFor(() => {
      expect(vi.mocked(fetchLiveNifty)).toHaveBeenCalledTimes(2);
    });
  });

  test("chart placeholder shows empty state when no candles", async () => {
    r(<NiftyReportPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("nifty-stat-strip")).toBeInTheDocument();
    });
    expect(screen.getByTestId("nifty-chart-empty")).toBeInTheDocument();
  });
});

describe("niftyOiColumns alignment meta", () => {
  test("every column declares explicit meta.align", () => {
    expect(niftyOiColumns.length).toBeGreaterThan(0);
    for (const col of niftyOiColumns) {
      const meta = (col as { meta?: { align?: string } }).meta;
      expect(meta?.align).toMatch(/^(left|center|right)$/);
    }
  });

  test("strike is numeric-right, signals are centered", () => {
    const byKey = new Map(
      niftyOiColumns.map((c) => [c.accessorKey as string, c.meta as { align: string }]),
    );
    expect(byKey.get("strike")?.align).toBe("right");
    expect(byKey.get("ce.sentiment")?.align).toBe("center");
    expect(byKey.get("pe.sentiment")?.align).toBe("center");
    expect(byKey.get("ce.oiChange")?.align).toBe("right");
    expect(byKey.get("pe.oiChange")?.align).toBe("right");
  });

  test("every column declares an explicit fixed width fitting 1440px", () => {
    for (const col of niftyOiColumns) {
      const size = (col as { size?: number }).size;
      expect(typeof size).toBe("number");
      expect(size as number).toBeGreaterThan(0);
    }
    const total = niftyOiColumns.reduce(
      (sum, c) => sum + ((c as { size?: number }).size ?? 0),
      0,
    );
    // 7 fixed columns must fit a 1440px panel with room for panel padding
    expect(total).toBeLessThanOrEqual(900);
  });
});

describe("NiftyReportPanel fit-to-screen", () => {
  function candles() {
    return [
      { time: "2026-10-12T09:15:00", open: 25600, high: 25650, low: 25580, close: 25620, volume: 1000 },
      { time: "2026-10-12T09:16:00", open: 25620, high: 25680, low: 25600, close: 25750.5, volume: 1200 },
    ];
  }

  function strikeAt(strike: number) {
    return {
      strike,
      ce: { ltp: 120, close: 110, oi: 2000, prevOi: 1800, oiChange: 200, priceChange: 9.09, sentiment: "Bullish" },
      pe: { ltp: 100, close: 105, oi: 2500, prevOi: 2600, oiChange: -100, priceChange: -4.76, sentiment: "Bearish" },
    };
  }

  test("chart panel fills width and wall mark lines are top-2 plus max pain", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({ candles: candles() }),
    );
    r(<NiftyReportPanel />);
    expect(await screen.findByTestId("nifty-chart-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-wrap")).toBeInTheDocument();
    const chart = screen.getByTestId("tradingview-chart");
    // top-2 call walls + top-2 put walls + max-pain line
    expect(chart).toHaveAttribute("data-marklines", "5");
  });

  test("OI table windows to ATM ±750 so strike and signals stay visible", async () => {
    vi.mocked(fetchLiveNifty).mockResolvedValueOnce(
      mockReport({
        spot: 25750.5,
        strikes: [strikeAt(25700), strikeAt(24000), strikeAt(27500)],
      }),
    );
    r(<NiftyReportPanel />);
    const table = await screen.findByTestId("nifty-oi-table");
    expect(table).toBeInTheDocument();
    expect(within(table).getByText("25,700")).toBeInTheDocument();
    expect(within(table).queryByText("24,000")).not.toBeInTheDocument();
    expect(within(table).queryByText("27,500")).not.toBeInTheDocument();
    // signals still rendered for the visible row
    expect(within(table).getByText("Bullish")).toBeInTheDocument();
    expect(within(table).getByText("Bearish")).toBeInTheDocument();
  });

  test("timeline items and side-by-side notes render", async () => {
    r(<NiftyReportPanel />);
    expect(await screen.findByTestId("nifty-timeline-item-0")).toBeInTheDocument();
    expect(screen.getByText("Nifty opened flat")).toBeInTheDocument();
    const notesRow = screen.getByTestId("nifty-notes-row");
    expect(notesRow).toBeInTheDocument();
    expect(within(notesRow).getByTestId("nifty-btst-note")).toBeInTheDocument();
    expect(within(notesRow).getByTestId("nifty-model-note")).toBeInTheDocument();
  });
});

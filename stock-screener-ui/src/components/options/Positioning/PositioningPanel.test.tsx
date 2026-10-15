// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../test-utils/renderWithProviders";
import { PositioningPanel } from "./PositioningPanel";
import { getPositioning, PositioningApiError } from "../../../api/upstoxOptions";
import type { PositioningData } from "@/utils/positioning";

vi.mock("../../../api/upstoxOptions", () => ({
  getPositioning: vi.fn(),
  PositioningApiError: class PositioningApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "PositioningApiError";
      this.status = status;
    }
  },
}));

vi.mock("../../../hooks/useECharts", () => ({
  useECharts: () => ({ chartRef: { current: null }, setChartOption: vi.fn() }),
}));

vi.mock("@/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ui")>();
  return {
    ...actual,
    Select: ({ value, onChange, data, "data-testid": testId, ...rest }: any) => (
      <select
        data-testid={testId}
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value === "" ? null : e.target.value)}
        {...rest}
      >
        {(data ?? []).map((opt: any) => {
          const v = typeof opt === "string" ? opt : opt.value;
          const label = typeof opt === "string" ? opt : opt.label;
          return (
            <option key={v} value={v}>
              {label}
            </option>
          );
        })}
      </select>
    ),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mockRow(strike: number, net_cr: number) {
  return {
    strike,
    ce_class: "Short Buildup",
    ce_doi_shares: 100000,
    ce_cr: net_cr / 2,
    pe_class: "Long Buildup",
    pe_doi_shares: 50000,
    pe_cr: net_cr / 2,
    net_cr,
  };
}

function mockData(overrides?: Partial<PositioningData>): PositioningData {
  return {
    status: "ok",
    underlying: "NIFTY",
    expiry: "2026-10-14",
    spot: 25400.5,
    lot_size: 25,
    timestamp: "2026-10-12T14:30:00+05:30",
    baseline: "prev_close_oi",
    baseline_note: "note",
    verdict: "bearish",
    initiated_cr: -87494.0,
    lean_pct: 78.5,
    state: { calls_cr: 1200000.0, puts_cr: -900000.0, note: "puts outweigh calls" },
    flow: { calls_cr: -50000.0, puts_cr: -37000.0, note: "calls outweigh puts" },
    initiated: { bearish_cr: -90000.0, bullish_cr: 2506.0, note: "Short build-up" },
    split: { bearish_cr: -90000.0, bearish_pct: 97.3, bullish_cr: 2506.0, bullish_pct: 2.7 },
    read: { pct: 92.4, readable_shares: 123456, total_shares: 133600 },
    biggest_move: {
      strike: 25400.0,
      side: "CE",
      sentiment: "Short Buildup",
      label: "call writers opened (today)",
      cr: -50462.0,
    },
    rows: [mockRow(25300, -1000), mockRow(25400, 2500)],
    ...overrides,
  };
}

const props = { underlying: "NIFTY", expiry: "2026-10-14" };

describe("PositioningPanel", () => {
  beforeEach(() => {
    vi.mocked(getPositioning).mockResolvedValue(mockData());
  });

  test("shows loading skeletons while fetching", () => {
    vi.mocked(getPositioning).mockReturnValue(new Promise(() => {}));
    renderWithProviders(<PositioningPanel {...props} />);
    expect(screen.getByTestId("positioning-loading")).toBeInTheDocument();
  });

  test("200 success renders banner, reading rows, and strike rows", async () => {
    renderWithProviders(<PositioningPanel {...props} />);
    expect(await screen.findByTestId("positioning-verdict")).toBeInTheDocument();
    expect(screen.getByTestId("positioning-verdict-word")).toHaveTextContent("Bearish");
    expect(screen.getByTestId("positioning-reading")).toBeInTheDocument();
    expect(screen.getByTestId("positioning-strike-row-25300")).toBeInTheDocument();
    expect(screen.getByTestId("positioning-strike-row-25400")).toBeInTheDocument();
    expect(vi.mocked(getPositioning)).toHaveBeenCalledWith("NIFTY", "2026-10-14", "since_open");
  });

  test("401 shows connect guidance with settings link", async () => {
    vi.mocked(getPositioning).mockRejectedValueOnce(new PositioningApiError("no token", 401));
    renderWithProviders(<PositioningPanel {...props} />);
    expect(await screen.findByTestId("positioning-error")).toBeInTheDocument();
    const link = screen.getByTestId("positioning-connect");
    expect(link).toBeInTheDocument();
    expect(link).toHaveTextContent("Connect Upstox in Settings");
    expect(link).toHaveAttribute("href", "/settings");
  });

  test("generic error shows message and retry refetches", async () => {
    const user = userEvent.setup();
    vi.mocked(getPositioning)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(mockData());
    renderWithProviders(<PositioningPanel {...props} />);
    expect(await screen.findByTestId("positioning-error")).toBeInTheDocument();
    expect(screen.getByTestId("positioning-error")).toHaveTextContent("boom");
    await user.click(screen.getByTestId("positioning-retry"));
    expect(await screen.findByTestId("positioning-verdict")).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(getPositioning)).toHaveBeenCalledTimes(2));
  });

  test("empty rows shows empty state", async () => {
    vi.mocked(getPositioning).mockResolvedValueOnce(mockData({ rows: [] }));
    renderWithProviders(<PositioningPanel {...props} />);
    expect(await screen.findByTestId("positioning-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("positioning-verdict")).not.toBeInTheDocument();
  });

  test("mode toggle refetches with mode param", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PositioningPanel {...props} />);
    expect(await screen.findByTestId("positioning-verdict")).toBeInTheDocument();
    const group = screen.getByTestId("positioning-mode");
    await user.click(within(group).getByRole("button", { name: "Prev close" }));
    await waitFor(() =>
      expect(vi.mocked(getPositioning)).toHaveBeenCalledWith("NIFTY", "2026-10-14", "prev_close"),
    );
  });

  test("view toggle switches table and chart", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PositioningPanel {...props} />);
    expect(await screen.findByTestId("positioning-strike-row-25300")).toBeInTheDocument();
    expect(screen.queryByTestId("positioning-chart")).not.toBeInTheDocument();
    const group = screen.getByTestId("positioning-view");
    await user.click(within(group).getByRole("button", { name: "Chart" }));
    expect(screen.getByTestId("positioning-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("positioning-strike-row-25300")).not.toBeInTheDocument();
    await user.click(within(group).getByRole("button", { name: "Table" }));
    expect(screen.getByTestId("positioning-strike-row-25300")).toBeInTheDocument();
    expect(screen.queryByTestId("positioning-chart")).not.toBeInTheDocument();
  });
});

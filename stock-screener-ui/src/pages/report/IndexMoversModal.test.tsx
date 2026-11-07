import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IndexMoversModal } from "./IndexMoversModal";
import { fetchIndexMovers, IndexMoversResponse } from "@/api/indexMovers";

// Mock the API
vi.mock("@/api/indexMovers", () => ({
  fetchIndexMovers: vi.fn(),
}));

const mockFetchIndexMovers = vi.mocked(fetchIndexMovers);

const createMockResponse = (overrides: Partial<IndexMoversResponse> = {}): IndexMoversResponse => ({
  index: "NIFTY",
  as_of: new Date().toISOString(),
  stale: false,
  source: "NIFTY50_WEIGHTS (Tickertape 2026-10-15)",
  gainers: [
    { symbol: "HDFCBANK", ltp: 1750.0, change_pct: 1.92, contribution_pct: 0.206, volume: 1234567 },
    { symbol: "TITAN", ltp: 3450.0, change_pct: 1.45, contribution_pct: 0.023, volume: 876543 },
    { symbol: "BAJFINANCE", ltp: 7200.0, change_pct: 1.12, contribution_pct: 0.027, volume: 543210 },
  ],
  losers: [
    { symbol: "TCS", ltp: 3450.0, change_pct: -2.52, contribution_pct: -0.058, volume: 987654 },
    { symbol: "INFY", ltp: 1450.0, change_pct: -1.73, contribution_pct: -0.063, volume: 765432 },
    { symbol: "HCLTECH", ltp: 1250.0, change_pct: -1.28, contribution_pct: -0.017, volume: 432109 },
  ],
  live_only: false,
  ...overrides,
});

describe("IndexMoversModal", () => {
  beforeEach(() => {
    mockFetchIndexMovers.mockReset();
  });

  it("renders nothing when closed", () => {
    render(<IndexMoversModal open={false} onClose={vi.fn()} index="NIFTY" />);
    expect(screen.queryByTestId("panel-modal")).not.toBeInTheDocument();
  });

  it("renders modal when open", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());

    render(<IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByTestId("panel-modal")).toBeInTheDocument(), { timeout: 10000 });
    // Title is in panel-modal-title
    expect(screen.getByTestId("panel-modal-title")).toHaveTextContent("MOVERS · NIFTY 50");
  });

  it("shows loading state initially", async () => {
    let resolve: (v: IndexMoversResponse) => void;
    const promise = new Promise<IndexMoversResponse>((r) => { resolve = r; });
    mockFetchIndexMovers.mockReturnValue(promise);

    render(<IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByTestId("panel-modal")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.getByText("loading movers…")).toBeInTheDocument();
  });

  it("renders table with gainers and losers in ALL tab", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());

    render(<IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByTestId("movers-table")).toBeInTheDocument(), { timeout: 10000 });
    
    // Click ALL tab
    await userEvent.click(screen.getByText("ALL"));
    
    await waitFor(() => expect(screen.getByText("HDFCBANK")).toBeInTheDocument(), { timeout: 10000 });
    await waitFor(() => expect(screen.getByText("TCS")).toBeInTheDocument(), { timeout: 10000 });
    await waitFor(() => expect(screen.getByText("INFY")).toBeInTheDocument(), { timeout: 10000 });
  });

  it("shows GAINERS tab with only gainers", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());

    render(<IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByTestId("movers-table")).toBeInTheDocument(), { timeout: 10000 });

    // Click GAINERS tab
    await userEvent.click(screen.getByText("GAINERS"));

    await waitFor(() => expect(screen.getByText("HDFCBANK")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.queryByText("TCS")).not.toBeInTheDocument();
    expect(screen.queryByText("INFY")).not.toBeInTheDocument();
  });

  it("shows LOSERS tab with only losers", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());

    render(<IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByTestId("movers-table")).toBeInTheDocument(), { timeout: 10000 });

    // Click LOSERS tab
    await userEvent.click(screen.getByText("LOSERS"));

    await waitFor(() => expect(screen.getByText("TCS")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.queryByText("HDFCBANK")).not.toBeInTheDocument();
  });

  it("sorts by change_pct desc by default", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());

    render(<IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByTestId("movers-table")).toBeInTheDocument(), { timeout: 10000 });

    // Check first row is highest gainer
    const rows = screen.getAllByRole("row");
    const firstDataRow = rows[1];
    expect(firstDataRow).toHaveTextContent("HDFCBANK");
  });

  it("shows stale badge when data.stale is true", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse({ stale: true }));

    render(<IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByText("STALE")).toBeInTheDocument(), { timeout: 10000 });
  });

  it("shows source and timestamp in footer", async () => {
    const now = new Date();
    const isoString = now.toISOString();
    mockFetchIndexMovers.mockResolvedValue(createMockResponse({ as_of: isoString }));

    render(<IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByTestId("movers-table")).toBeInTheDocument(), { timeout: 10000 });

    expect(screen.getByText(/Source: NIFTY50_WEIGHTS/)).toBeInTheDocument();
    expect(screen.getByText(/As of:/)).toBeInTheDocument();
  });

  it("calls onClose when close button clicked", async () => {
    const onClose = vi.fn();
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());

    render(<IndexMoversModal open={true} onClose={onClose} index="NIFTY" />);

    await waitFor(() => expect(screen.getByTestId("panel-modal-close")).toBeInTheDocument(), { timeout: 10000 });
    await userEvent.click(screen.getByTestId("panel-modal-close"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows error state when fetch fails", async () => {
    mockFetchIndexMovers.mockRejectedValue(new Error("Network error"));

    render(<IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByText("unavailable")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("shows MOVERS_UNAVAILABLE error correctly", async () => {
    mockFetchIndexMovers.mockRejectedValue(new Error("MOVERS_UNAVAILABLE"));

    render(<IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByText("unavailable")).toBeInTheDocument(), { timeout: 10000 });
  });

  it("renders SENSEX 30 label correctly", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse({ index: "SENSEX" }));

    render(<IndexMoversModal open={true} onClose={vi.fn()} index="SENSEX" />);

    await waitFor(() => expect(screen.getByTestId("panel-modal")).toBeInTheDocument(), { timeout: 10000 });
    // Title is in panel-modal-title
    expect(screen.getByTestId("panel-modal-title")).toHaveTextContent("MOVERS · SENSEX 30");
  });

  it("contribution column shows — when missing", async () => {
    // Response without contribution_pct
    const response = createMockResponse();
    response.gainers[0] = { ...response.gainers[0], contribution_pct: undefined };
    response.losers[0] = { ...response.losers[0], contribution_pct: undefined };
    mockFetchIndexMovers.mockResolvedValue(response);

    render(<IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByTestId("movers-table")).toBeInTheDocument(), { timeout: 10000 });

    // Should show — for missing contribution
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
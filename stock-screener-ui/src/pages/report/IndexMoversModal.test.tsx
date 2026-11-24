import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@solidjs/testing-library";
import { For } from "solid-js";
import { IndexMoversModal } from "./IndexMoversModal";
import { fetchIndexMovers, IndexMoversResponse } from "@/api/indexMovers";

vi.mock("@/api/indexMovers", () => ({
  fetchIndexMovers: vi.fn(),
}));

vi.mock("@/components/common/TanStackTable", () => ({
  TanStackTable: (props: any) => (
    <table data-testid={props.dataTestId}>
      <thead>
        <tr>
          {props.columns.map((col: any) => (
            <th>{typeof col.header === "string" ? col.header : null}</th>
          ))}
        </tr>
      </thead>
      <For each={props.data}>
        {(row: any, i) => (
          <tr>
            {props.columns.map((col: any) => (
              <td>{col.cell ? col.cell({ row: { original: row, index: i() }, column: col }) : null}</td>
            ))}
          </tr>
        )}
      </For>
    </table>
  ),
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
    render(() => <IndexMoversModal open={false} onClose={vi.fn()} index="NIFTY" />);
    expect(screen.queryByTestId("panel-modal")).not.toBeInTheDocument();
  });

  it("renders modal when open", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());

    render(() => <IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByTestId("panel-modal")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.getByTestId("panel-modal-title")).toHaveTextContent("MOVERS · NIFTY 50");
  });

  it("shows loading state initially", async () => {
    let _resolve: (v: IndexMoversResponse) => void;
    const promise = new Promise<IndexMoversResponse>((r) => { _resolve = r; });
    mockFetchIndexMovers.mockReturnValue(promise);

    render(() => <IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByTestId("panel-modal")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.getByText("loading movers…")).toBeInTheDocument();
  });

  it("renders table with gainers and losers in ALL tab", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());

    render(() => <IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByTestId("movers-table")).toBeInTheDocument(), { timeout: 10000 });
    
    fireEvent.click(screen.getByText("ALL"));
    
    await waitFor(() => expect(screen.getByText("HDFCBANK")).toBeInTheDocument(), { timeout: 10000 });
    await waitFor(() => expect(screen.getByText("TCS")).toBeInTheDocument(), { timeout: 10000 });
    await waitFor(() => expect(screen.getByText("INFY")).toBeInTheDocument(), { timeout: 10000 });
  });

  it("shows GAINERS tab with only gainers", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());

    render(() => <IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByTestId("movers-table")).toBeInTheDocument(), { timeout: 10000 });

    fireEvent.click(screen.getByText("GAINERS"));

    await waitFor(() => expect(screen.getByText("HDFCBANK")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.queryByText("TCS")).not.toBeInTheDocument();
    expect(screen.queryByText("INFY")).not.toBeInTheDocument();
  });

  it("shows LOSERS tab with only losers", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());

    render(() => <IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByTestId("movers-table")).toBeInTheDocument(), { timeout: 10000 });

    fireEvent.click(screen.getByText("LOSERS"));

    await waitFor(() => expect(screen.getByText("TCS")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.queryByText("HDFCBANK")).not.toBeInTheDocument();
  });

  it("sorts by change_pct desc by default", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());

    render(() => <IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByTestId("movers-table")).toBeInTheDocument(), { timeout: 10000 });

    const rows = screen.getAllByRole("row");
    const firstDataRow = rows[1];
    expect(firstDataRow).toHaveTextContent("HDFCBANK");
  });

  it("shows stale badge when data.stale is true", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse({ stale: true }));

    render(() => <IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByText("STALE")).toBeInTheDocument(), { timeout: 10000 });
  });

  it("shows source and timestamp in footer", async () => {
    const now = new Date();
    const isoString = now.toISOString();
    mockFetchIndexMovers.mockResolvedValue(createMockResponse({ as_of: isoString }));

    render(() => <IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByTestId("movers-table")).toBeInTheDocument(), { timeout: 10000 });

    expect(screen.getByTestId("movers-modal-source")).toHaveTextContent("Source:");
    expect(screen.getByTestId("movers-modal-source")).toHaveTextContent("NIFTY50_WEIGHTS");
    expect(screen.getByTestId("movers-modal-asof")).toHaveTextContent("As of:");
  });

  it("calls onClose when close button clicked", async () => {
    const onClose = vi.fn();
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());

    render(() => <IndexMoversModal open={true} onClose={onClose} index="NIFTY" />);

    await waitFor(() => expect(screen.getByTestId("panel-modal-close")).toBeInTheDocument(), { timeout: 10000 });
    fireEvent.click(screen.getByTestId("panel-modal-close"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows error state when fetch fails", async () => {
    mockFetchIndexMovers.mockRejectedValue(new Error("Network error"));

    render(() => <IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByText("unavailable")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("shows MOVERS_UNAVAILABLE error correctly", async () => {
    mockFetchIndexMovers.mockRejectedValue(new Error("MOVERS_UNAVAILABLE"));

    render(() => <IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByText("unavailable")).toBeInTheDocument(), { timeout: 10000 });
  });

  it("renders SENSEX 30 label correctly", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse({ index: "SENSEX" }));

    render(() => <IndexMoversModal open={true} onClose={vi.fn()} index="SENSEX" />);

    await waitFor(() => expect(screen.getByTestId("panel-modal")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.getByTestId("panel-modal-title")).toHaveTextContent("MOVERS · SENSEX 30");
  });

  it("uses a 16px section title, 12px labels, 13px values and an 8px footer rhythm", async () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/pages/report/IndexMoversModal.tsx"),
      "utf8",
    );
    expect(source).toContain('class="font-mono text-ui-title');
    expect(source).toContain('data-report-spacing="8"');
    expect(source).toContain("gap-2 flex-wrap mt-2 pt-2 border-t");
    expect(source).not.toContain("truncate");
    expect(source).not.toContain("text-ellipsis");

    mockFetchIndexMovers.mockResolvedValue(createMockResponse());
    render(() => <IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);
    await waitFor(() => expect(screen.getByTestId("movers-modal-footer")).toBeInTheDocument(), { timeout: 10000 });
    const footer = screen.getByTestId("movers-modal-footer");
    expect(footer.getAttribute("data-report-spacing")).toBe("8");
    for (const label of footer.querySelectorAll('[data-report-text="label"]')) {
      expect(label.className).toContain("text-ui-micro");
    }
    for (const value of footer.querySelectorAll('[data-report-text="value"]')) {
      expect(value.className).toContain("text-ui-body");
      expect(value.className).toContain("whitespace-nowrap");
    }
  });

  it("contribution column shows — when missing", async () => {
    const response = createMockResponse();
    response.gainers[0] = { ...response.gainers[0], contribution_pct: undefined };
    response.losers[0] = { ...response.losers[0], contribution_pct: undefined };
    mockFetchIndexMovers.mockResolvedValue(response);

    render(() => <IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);

    await waitFor(() => expect(screen.getByTestId("movers-table")).toBeInTheDocument(), { timeout: 10000 });

    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
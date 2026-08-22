// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { ScreenerSymbolPicker } from "./ScreenerSymbolPicker";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockFetchWithAuth = vi.fn();

vi.mock("../../state/auth", () => ({
  fetchWithAuth: (...args: any[]) => mockFetchWithAuth(...args),
}));

const MOCK_STOCKS = {
  approaching: [
    { symbol: "RELIANCE", upstox_price: 2845, tv_price: 2840, to_52w_high: -12.3, score: 92, touched_52w: false },
    { symbol: "TCS", upstox_price: 3912, tv_price: 3900, to_52w_high: -8.1, score: 88, touched_52w: false },
    { symbol: "INFY", upstox_price: 1567, tv_price: 1560, to_52w_high: -15.2, score: 76, touched_52w: false },
  ],
  touched: [
    { symbol: "TATACOMM", upstox_price: 1234, tv_price: 1230, to_52w_high: -0.3, score: 65, touched_52w: true },
    { symbol: "HDFCBANK", upstox_price: 1723, tv_price: 1720, to_52w_high: -2.1, score: 71, touched_52w: true },
  ],
};

function renderPicker(props?: { symbols?: string[]; onAddSymbols?: any }) {
  return render(
    <UIProvider>
      <ScreenerSymbolPicker
        symbols={props?.symbols ?? []}
        onAddSymbols={props?.onAddSymbols ?? vi.fn()}
      />
    </UIProvider>,
  );
}

describe("ScreenerSymbolPicker", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the Load button", () => {
    renderPicker();
    expect(screen.getByTestId("screener-picker-btn")).toBeInTheDocument();
  });

  it("opens modal on Load button click", async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByTestId("screener-picker-btn"));
    expect(screen.getByTestId("screener-picker-modal")).toBeInTheDocument();
  });

  it("shows screener select and load button in modal", async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByTestId("screener-picker-btn"));
    expect(screen.getByTestId("screener-select")).toBeInTheDocument();
    expect(screen.getByTestId("screener-load-btn")).toBeInTheDocument();
  });

  it("loads and displays stocks from screener", async () => {
    const user = userEvent.setup();
    mockFetchWithAuth.mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_STOCKS), { status: 200 }),
    );
    renderPicker();
    await user.click(screen.getByTestId("screener-picker-btn"));
    await user.click(screen.getByTestId("screener-load-btn"));
    expect(await screen.findByTestId("screener-stock-list")).toBeInTheDocument();
    expect(screen.getByTestId("stock-check-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("stock-check-TCS")).toBeInTheDocument();
    expect(screen.getByTestId("stock-check-INFY")).toBeInTheDocument();
    expect(screen.getByTestId("stock-check-TATACOMM")).toBeInTheDocument();
    expect(screen.getByTestId("stock-check-HDFCBANK")).toBeInTheDocument();
  });

  it("shows All and Touched checkboxes", async () => {
    const user = userEvent.setup();
    mockFetchWithAuth.mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_STOCKS), { status: 200 }),
    );
    renderPicker();
    await user.click(screen.getByTestId("screener-picker-btn"));
    await user.click(screen.getByTestId("screener-load-btn"));
    expect(await screen.findByTestId("screener-select-all")).toBeInTheDocument();
    expect(screen.getByTestId("screener-select-touched")).toBeInTheDocument();
  });

  it("selects all stocks when All checkbox is checked", async () => {
    const user = userEvent.setup();
    mockFetchWithAuth.mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_STOCKS), { status: 200 }),
    );
    renderPicker();
    await user.click(screen.getByTestId("screener-picker-btn"));
    await user.click(screen.getByTestId("screener-load-btn"));
    await screen.findByTestId("screener-select-all");
    await user.click(screen.getByTestId("screener-select-all"));
    expect(screen.getByTestId("screener-add-btn")).not.toBeDisabled();
    expect(screen.getByText(/5 of 5 selected/)).toBeInTheDocument();
  });

  it("calls onAddSymbols with selected stocks", async () => {
    const onAddSymbols = vi.fn();
    const user = userEvent.setup();
    mockFetchWithAuth.mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_STOCKS), { status: 200 }),
    );
    renderPicker({ onAddSymbols });
    await user.click(screen.getByTestId("screener-picker-btn"));
    await user.click(screen.getByTestId("screener-load-btn"));
    await screen.findByTestId("screener-select-all");
    await user.click(screen.getByTestId("screener-select-all"));
    await user.click(screen.getByTestId("screener-add-btn"));
    expect(onAddSymbols).toHaveBeenCalledWith(
      expect.arrayContaining(["RELIANCE", "TCS", "INFY", "TATACOMM", "HDFCBANK"]),
    );
  });

  it("filters out already-selected symbols", async () => {
    const onAddSymbols = vi.fn();
    const user = userEvent.setup();
    mockFetchWithAuth.mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_STOCKS), { status: 200 }),
    );
    renderPicker({ symbols: ["RELIANCE", "TCS"], onAddSymbols });
    await user.click(screen.getByTestId("screener-picker-btn"));
    await user.click(screen.getByTestId("screener-load-btn"));
    await screen.findByTestId("screener-select-all");
    await user.click(screen.getByTestId("screener-select-all"));
    await user.click(screen.getByTestId("screener-add-btn"));
    expect(onAddSymbols).toHaveBeenCalledWith(
      expect.not.arrayContaining(["RELIANCE", "TCS"]),
    );
    expect(onAddSymbols).toHaveBeenCalledWith(
      expect.arrayContaining(["INFY", "TATACOMM", "HDFCBANK"]),
    );
  });

  it("shows error state on fetch failure", async () => {
    const user = userEvent.setup();
    mockFetchWithAuth.mockRejectedValueOnce(new Error("Network error"));
    renderPicker();
    await user.click(screen.getByTestId("screener-picker-btn"));
    await user.click(screen.getByTestId("screener-load-btn"));
    expect(await screen.findByTestId("screener-error")).toBeInTheDocument();
  });

  it("shows empty state when no stocks returned", async () => {
    const user = userEvent.setup();
    mockFetchWithAuth.mockResolvedValueOnce(
      new Response(JSON.stringify({ approaching: [], touched: [] }), { status: 200 }),
    );
    renderPicker();
    await user.click(screen.getByTestId("screener-picker-btn"));
    await user.click(screen.getByTestId("screener-load-btn"));
    expect(await screen.findByTestId("screener-empty")).toBeInTheDocument();
  });
});

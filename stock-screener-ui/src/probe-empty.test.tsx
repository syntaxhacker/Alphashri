// @vitest-environment happy-dom
import { test, vi } from "vitest";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { WatchlistScan2 } from "./components/paper-trading/WatchlistScan2";

const snap: any = {
  timestamp: new Date().toISOString(),
  watchlist: ["RELIANCE"],
  open_positions: [],
  signals: [],
  scan_items: [
    { symbol: "HDFC", status: "skipped", side: "LONG", price: 2520, reason: "x", strategy_name: "ORB", strategy_id: 1 },
  ],
};

vi.mock("../../state/paperTrading", () => ({
  getPaperTradingState: vi.fn(() => ({ chartTimeframe: "5min", selectedStrategyId: null })),
  setSelectedSymbol: vi.fn(),
  setSelectedTradeId: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
}));
vi.mock("../../api/paperTrading", () => ({ fetchPaperChart: vi.fn().mockResolvedValue(undefined) }));

test("dump after ZZZZ search", async () => {
  const { container } = render(() => <WatchlistScan2 snapshot={snap} selectedSymbol={null} />);
  const searchInput = screen.getByPlaceholderText("Search symbol");
  fireEvent.input(searchInput, { target: { value: "ZZZZ" } });
  console.log("html:", container.innerHTML.slice(-700));
});

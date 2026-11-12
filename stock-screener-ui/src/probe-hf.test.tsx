// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";
import { HistoryFilters } from "./components/paper-trading/PaperTradingHelpers";

const mockStateStore: any = {
  currentView: "history", positions: [], portfolio: null, trades: [],
  filterFromDate: "2026-04-01", filterToDate: "2026-04-27", filterSymbol: null,
};

vi.mock("../../state/paperTrading", () => ({}));
vi.mock("../../api/paperTrading", () => ({}));

afterEach(() => cleanup());

test("filter-from-date wrapper contains input", () => {
  const filters = { handleFilterFromDate: vi.fn(), handleFilterToDate: vi.fn(), handleFilterSymbol: vi.fn() };
  const { container } = render(() => <HistoryFilters state={mockStateStore} filters={filters} />);
  const el = screen.getByTestId("filter-from-date");
  console.log("tag:", el.tagName, el.outerHTML.slice(0, 400));
  expect(el.querySelector("input")).not.toBeNull();
});

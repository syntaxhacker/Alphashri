// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DiaryStrip } from "./DiaryStrip";
import { newPaperTrade, type PaperTrade } from "./paperTrades";
import { setupBrowserMocks } from "../../../test-utils/setupBrowser";
import { renderWithProviders } from "../../../test-utils/renderWithProviders";

const today = new Date().toISOString().slice(0, 10);

function makeTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    ...newPaperTrade({
      date: today,
      underlying: "NIFTY",
      side: "CE",
      strike: 23150,
      qty: 50,
      entry: 100,
      note: "",
    }),
    ...overrides,
  };
}

beforeEach(() => {
  setupBrowserMocks();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DiaryStrip", () => {
  it("renders day options with today first plus summary", () => {
    const trades = [
      makeTrade({ date: "2026-09-26", exit: 150 }),
      makeTrade({ date: today, exit: 80 }),
    ];
    renderWithProviders(<DiaryStrip trades={trades} onSetExit={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.getByTestId("diary-strip")).toBeInTheDocument();
    // Today is the default selected day
    expect(screen.getByTestId("diary-day").textContent).toContain(today);
    // Summary shows wins/closed for today
    expect(screen.getByTestId("diary-summary").textContent).toContain("0/1 wins");

    // Open the select and check all day options (today first)
    const combo = within(screen.getByTestId("diary-day")).getByRole("combobox");
    fireEvent.mouseDown(combo);
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([today, "2026-09-26"]);
  });

  it("calls onSetExit with a number when Set is clicked", () => {
    const trade = makeTrade({ exit: null });
    const onSetExit = vi.fn();
    renderWithProviders(<DiaryStrip trades={[trade]} onSetExit={onSetExit} onDelete={vi.fn()} />);

    fireEvent.change(
      within(screen.getByTestId(`diary-exit-input-${trade.id}`)).getByRole("spinbutton"),
      { target: { value: "120" } },
    );
    fireEvent.click(screen.getByTestId(`diary-exit-set-${trade.id}`));
    expect(onSetExit).toHaveBeenCalledWith(trade.id, 120);
  });

  it("saves the lesson to localStorage on blur", () => {
    renderWithProviders(<DiaryStrip trades={[]} onSetExit={vi.fn()} onDelete={vi.fn()} />);

    const input = screen.getByTestId("diary-lesson");
    fireEvent.change(input, { target: { value: "Cut losers fast" } });
    fireEvent.focusOut(input);
    expect(localStorage.getItem(`premium-lesson-${today}`)).toBe(JSON.stringify("Cut losers fast"));
  });

  it("shows the empty message when the day has no fills", () => {
    renderWithProviders(<DiaryStrip trades={[]} onSetExit={vi.fn()} onDelete={vi.fn()} />);
    expect(
      screen.getByText("No fills this day — paper trade from a strategy card above."),
    ).toBeInTheDocument();
  });
});

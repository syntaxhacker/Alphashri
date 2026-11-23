// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { OptionPositionsPanel } from "./OptionPositionsPanel";
import { fetchOptionPaperPositions } from "@/api/optionsPaper";
import { getOptionsPaperState, resetOptionsPaper, setSelectedPosition } from "@/state/optionsPaper";
import type { OptionPaperPosition } from "@/types/optionsPaper";

vi.mock("@/api/optionsPaper", () => ({
  fetchOptionPaperPositions: vi.fn(),
  addOptionPaperLeg: vi.fn(),
}));
const fetchMock = vi.mocked(fetchOptionPaperPositions);

function position(id: number, overrides: Partial<OptionPaperPosition> = {}): OptionPaperPosition {
  return {
    id,
    uuid: `pos-${id}`,
    userId: 3,
    source: id === 2 ? "replay" : "live",
    status: "open",
    underlying: id === 2 ? "IRFC" : "RELIANCE",
    expiry: "2026-11-26",
    name: "Bull call spread",
    entryTs: "2026-11-17T09:15:00+05:30",
    entrySpot: 83,
    lots: 1,
    netDebit: 420,
    costsEst: 90,
    maxProfit: 1500,
    maxLoss: 420,
    breakevens: [84],
    realizedPnl: 0,
    closeReason: null,
    closedAt: null,
    notes: "",
    legs: [
      {
        id: id * 10,
        positionId: id,
        action: "BUY",
        optType: "CE",
        strike: 82.5,
        lots: 1,
        qty: 75,
        instrumentKey: "NSE_FO|82.5CE",
        entryPremium: 6,
        markPremium: 7,
        markTs: null,
        exitPremium: null,
      },
    ],
    unrealizedPnl: 75,
    totalPnl: 75,
    markSpot: 84,
    markTs: null,
    dte: 4,
    createdAt: "2026-11-17T09:15:00+05:30",
    updatedAt: "2026-11-22T09:15:00+05:30",
    ...overrides,
  };
}

function renderPanel() {
  return render(() => (
    <UIProvider>
      <OptionPositionsPanel />
    </UIProvider>
  ));
}

beforeEach(() => {
  resetOptionsPaper();
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("OptionPositionsPanel", () => {
  it("renders an empty state when the book has no positions", async () => {
    fetchMock.mockResolvedValueOnce([]);
    renderPanel();

    expect(await screen.findByTestId("option-positions-empty")).toHaveTextContent(
      "No option positions",
    );
  });

  it("lists positions with book badges and selects a row on click", async () => {
    fetchMock.mockResolvedValueOnce([position(1), position(2)]);
    renderPanel();

    const first = await screen.findByTestId("option-positions-row-1");
    expect(first).toHaveTextContent("RELIANCE");
    expect(screen.getByTestId("option-positions-row-2")).toHaveTextContent("REPLAY");
    expect(screen.getByTestId("option-positions-table")).toBeInTheDocument();

    fireEvent.click(first);
    expect(getOptionsPaperState().selectedPositionId).toBe(1);
  });

  it("renders a fetch failure inline", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Failed to fetch option positions (HTTP 500)"));
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("option-positions-error")).toHaveTextContent("HTTP 500"),
    );
  });

  it("renders a loading state while the book is fetched", async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => undefined));
    renderPanel();

    expect(await screen.findByTestId("option-positions-loading")).toBeInTheDocument();
  });

  it("signposts horizontal scrolling at narrow widths and labels the table", async () => {
    fetchMock.mockResolvedValueOnce([position(1)]);
    renderPanel();

    await screen.findByTestId("option-positions-row-1");
    const hint = screen.getByTestId("option-positions-scroll-hint");
    expect(hint).toHaveTextContent("Scroll horizontally");
    expect(hint.className).toContain("sm:hidden");
    expect(screen.getByTestId("option-positions-table")).toHaveAccessibleName(
      "Option paper positions",
    );
  });

  it("renders a titled header and a roomy bare table with an 11px scroll chip", async () => {
    fetchMock.mockResolvedValueOnce([position(1)]);
    renderPanel();

    await screen.findByTestId("option-positions-row-1");
    const header = screen.getByTestId("option-positions-header");
    expect(header.className).toContain("border-fin-border-subtle");
    expect(within(header).getByText("PAPER BOOK")).toHaveStyle({ "font-size": "18px" });

    const wrap = screen.getByTestId("option-positions-table-wrap");
    expect(wrap.className).toContain("[&_td]:px-3!");
    expect(
      screen.getByTestId("option-positions-table").closest(".paper-tanstack-container"),
    ).toBeNull();

    const hint = screen.getByTestId("option-positions-scroll-hint");
    expect(within(hint).getByText(/Scroll horizontally/).className).toContain("text-ui-micro");
    expect(hint).toHaveTextContent("↔");
  });

  it("opens the add-leg dialog for the selected position", async () => {
    fetchMock.mockResolvedValueOnce([position(1)]);
    renderPanel();

    fireEvent.click(await screen.findByTestId("option-positions-row-1"));
    fireEvent.click(screen.getByTestId("option-positions-add-leg"));

    expect(screen.getByTestId("add-leg-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("add-leg-existing")).toHaveTextContent("BUY CE 82.5");
  });

  it("disables ADD LEG without a selection and for a full structure", async () => {
    fetchMock.mockResolvedValueOnce([position(1)]);
    renderPanel();
    await screen.findByTestId("option-positions-row-1");
    const button = screen.getByTestId("option-positions-add-leg");

    setSelectedPosition(null);
    expect(button).toBeDisabled();
  });

  it("disables ADD LEG when the selected position already has four legs", async () => {
    const base = position(1).legs[0];
    const full = position(1, {
      legs: [0, 1, 2, 3].map((index) => ({ ...base, id: index + 1, strike: 80 + index })),
    });
    fetchMock.mockResolvedValueOnce([full]);
    renderPanel();

    await screen.findByTestId("option-positions-row-1");
    expect(screen.getByTestId("option-positions-add-leg")).toBeDisabled();
  });
});

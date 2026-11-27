// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { UIProvider } from "@/ui";
import { PaperOrderBand } from "./PaperOrderBand";
import { fetchReplaySessions, placeOptionPaperOrder, previewOptionPaperOrder } from "@/api/optionsPaper";
import { getOptionsPaperState, resetOptionsPaper } from "@/state/optionsPaper";
import { showSuccess } from "@/ui/notifications";
import type { OptionPaperPosition, OptionReplayResult } from "@/types/optionsPaper";
import type { OrderLegInput } from "./optionOrder.spec";

vi.mock("@/api/optionsPaper", () => ({
  placeOptionPaperOrder: vi.fn(),
  previewOptionPaperOrder: vi.fn(),
  fetchReplaySessions: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/ui/notifications", () => ({ showSuccess: vi.fn(), showError: vi.fn() }));

const routerMocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@solidjs/router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useNavigate: () => routerMocks.navigate };
});

const placeMock = vi.mocked(placeOptionPaperOrder);
const previewMock = vi.mocked(previewOptionPaperOrder);
const sessionsMock = vi.mocked(fetchReplaySessions);

/** 2026-11-23 10:00 IST — five NSE sessions back lands on 2026-11-16. */
const NOW = new Date("2026-11-23T04:30:00.000Z");

function pinClock() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
}

const legs: OrderLegInput[] = [
  { side: "buy", type: "CE", strike: 1420, premium: 12.5, lots: 1, lotSize: 75 },
  { side: "sell", type: "CE", strike: 1450, premium: 6.2, lots: 1, lotSize: 75 },
];

function position(): OptionPaperPosition {
  return {
    id: 7,
    uuid: "pos-7",
    userId: 3,
    source: "live",
    status: "open",
    underlying: "RELIANCE",
    expiry: "2026-11-26",
    name: "Bull call spread",
    entryTs: "2026-11-22T09:15:00+05:30",
    entrySpot: 1417.4,
    lots: 1,
    netDebit: 472.5,
    costsEst: 90,
    maxProfit: 1600,
    maxLoss: 472.5,
    breakevens: [1426],
    realizedPnl: 0,
    closeReason: null,
    closedAt: null,
    notes: "",
    legs: [],
    unrealizedPnl: 120,
    totalPnl: 120,
    markSpot: 1419,
    markTs: null,
    dte: 4,
    createdAt: "2026-11-22T09:15:00+05:30",
    updatedAt: "2026-11-22T09:15:00+05:30",
  };
}

function replay(): OptionReplayResult {
  return {
    positionId: null,
    underlying: "RELIANCE",
    expiry: "2026-11-26",
    source: "replay",
    frames: [],
    legs: [],
    netDebit: 0,
    summary: { realized: 0, unrealized: 0, total: 0, maxDrawdown: 0, costs: 0 },
    coverage: { frames: 0, first: null, last: null, gaps: 0 },
    payoff: { spots: [], expiry: [] },
    breakevens: [],
    maxProfit: 0,
    maxLoss: 0,
    skipped: null,
  };
}

function renderBand(props: Partial<{ legs: OrderLegInput[] }> = {}) {
  const jsx: JSX.Element = (
    <PaperOrderBand
      symbol="reliance"
      expiry="2026-11-26"
      legs={props.legs ?? legs}
      chainLadder={{ spot: 1417.4, strikes: [1400, 1420, 1450] }}
    />
  );
  return render(() => <UIProvider>{jsx}</UIProvider>);
}

beforeEach(() => {
  resetOptionsPaper();
  vi.resetAllMocks();
  placeMock.mockResolvedValue({ dryRun: false, position: position(), replay: null });
  previewMock.mockResolvedValue(replay());
  sessionsMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PaperOrderBand", () => {
  it("renders the order controls, quote and margin warning", () => {
    renderBand();
    expect(screen.getByTestId("paper-order-band")).toBeInTheDocument();
    expect(screen.getByTestId("paper-order-type")).toBeInTheDocument();
    expect(screen.getByTestId("paper-order-lots")).toBeInTheDocument();
    expect(screen.getByTestId("paper-order-slippage")).toBeInTheDocument();
    expect(screen.getByTestId("paper-order-debit")).toHaveTextContent("NET DEBIT");
    expect(screen.getByTestId("paper-order-costs")).toHaveTextContent("ENTRY COSTS");
    expect(screen.getByTestId("paper-order-margin-warning")).toBeInTheDocument();
    expect(screen.getByTestId("paper-order-place")).toBeInTheDocument();
    expect(screen.getByTestId("paper-order-replay")).toBeInTheDocument();
  });

  it("uses a spaced intro/controls/summary layout with full-width 34px actions", () => {
    renderBand();
    expect(screen.getByTestId("dock-section-paper-order")).toBeInTheDocument();
    expect(screen.getByTestId("paper-order-band").textContent).toContain("No real funds");

    const controls = screen.getByTestId("paper-order-controls");
    expect(controls.style.gap).toBe("12px");
    expect(screen.getByTestId("paper-order-lots-field").className).toContain("gap-1");

    const summary = screen.getByTestId("paper-order-summary");
    expect(summary.style.gap).toBe("8px");
    expect(summary.className).toContain("border-fin-border-subtle");
    expect(screen.getByTestId("paper-order-debit").className).toContain("font-mono");
    expect(screen.getByTestId("paper-order-debit").className).toContain("tabular-nums");
    expect(screen.getByTestId("paper-order-margin-warning").style.fontSize).toBe("12px");

    const actions = screen.getByTestId("paper-order-actions");
    expect(actions.style.gap).toBe("8px");
    for (const id of ["paper-order-place", "paper-order-replay"]) {
      const button = screen.getByTestId(id);
      expect(button.className).toContain("h-[34px]");
      expect(button.className).toContain("w-full");
    }
  });

  it("omits the margin warning for a buy-only structure", () => {
    renderBand({ legs: [legs[0]] });
    expect(screen.queryByTestId("paper-order-margin-warning")).not.toBeInTheDocument();
  });

  it("places a live order, upserts the position and toasts", async () => {
    renderBand();
    fireEvent.input(screen.getByTestId("paper-order-lots-input"), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("paper-order-place"));

    await waitFor(() => expect(placeMock).toHaveBeenCalledTimes(1));
    expect(placeMock.mock.calls[0][0]).toMatchObject({
      underlying: "RELIANCE",
      expiry: "2026-11-26",
      source: "live",
      legs: [
        { action: "BUY", opt: "CE", strike: 1420, premium: 12.5, lots: 3 },
        { action: "SELL", opt: "CE", strike: 1450, premium: 6.2, lots: 3 },
      ],
    });
    await waitFor(() => expect(getOptionsPaperState().positions).toHaveLength(1));
    expect(showSuccess).toHaveBeenCalled();
  });

  it("renders an API failure inline", async () => {
    placeMock.mockRejectedValueOnce(new Error("Failed to place paper order (HTTP 422): bad leg"));
    renderBand();
    fireEvent.click(screen.getByTestId("paper-order-place"));

    await waitFor(() =>
      expect(screen.getByTestId("paper-order-error")).toHaveTextContent("HTTP 422"),
    );
  });

  it("shows validation errors without posting", async () => {
    renderBand({ legs: [] });
    fireEvent.click(screen.getByTestId("paper-order-place"));

    await waitFor(() =>
      expect(screen.getByTestId("paper-order-error")).toHaveTextContent("Select at least one leg"),
    );
    expect(placeMock).not.toHaveBeenCalled();
  });

  it("previews a backdated replay and navigates with only the identity params", async () => {
    sessionsMock.mockResolvedValueOnce([
      { underlying: "RELIANCE", expiry: "2026-11-26", date: "2026-11-20", source: "snapshot", frames: 12 },
    ]);
    renderBand();
    fireEvent.click(screen.getByTestId("paper-order-replay"));

    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1));
    const request = previewMock.mock.calls[0][0];
    expect(request).toMatchObject({ source: "replay", underlying: "RELIANCE" });
    expect(request.entryTs).toMatch(/T09:47:00\+05:30$/);
    await waitFor(() =>
      expect(routerMocks.navigate).toHaveBeenCalledWith(
        "/options/replay?underlying=RELIANCE&expiry=2026-11-26",
      ),
    );
  });

  it("uses the nearest recorded session date inside the recorded window", async () => {
    pinClock();
    sessionsMock.mockResolvedValueOnce([
      { underlying: "RELIANCE", expiry: "2026-11-26", date: "2026-11-17", source: "snapshot", frames: 20 },
    ]);
    renderBand();
    fireEvent.click(screen.getByTestId("paper-order-replay"));

    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1));
    // Naive five-session date is 2026-11-16; the only recording is 2026-11-17.
    expect(previewMock.mock.calls[0][0].entryTs).toBe("2026-11-17T09:47:00+05:30");
    await waitFor(() => expect(routerMocks.navigate).toHaveBeenCalled());
  });

  it("blocks a doomed preview with actionable guidance when no chain is recorded", async () => {
    pinClock();
    sessionsMock.mockResolvedValueOnce([]);
    renderBand();
    fireEvent.click(screen.getByTestId("paper-order-replay"));

    await waitFor(() => expect(fetchReplaySessions).toHaveBeenCalledTimes(1));
    const errorBox = await screen.findByTestId("paper-order-error");
    expect(errorBox).toHaveTextContent("No recorded history for RELIANCE");
    expect(errorBox).toHaveTextContent("Place a live paper trade or pick another symbol");
    expect(errorBox.textContent?.length ?? 0).toBeLessThan(120);
    // No doomed fallback submission, no raw HTTP dump, no navigation.
    expect(previewMock).not.toHaveBeenCalled();
    expect(routerMocks.navigate).not.toHaveBeenCalled();
    expect(errorBox).not.toHaveTextContent("HTTP 400");
  });

  it("counts other recorded symbols without dumping them when only other underlyings have chains", async () => {
    pinClock();
    const others = ["NIFTY", "BANKNIFTY", "RELIANCE-X", "NIFTY"];
    sessionsMock.mockResolvedValueOnce(
      others.map((underlying) => ({
        underlying,
        expiry: "2026-11-26",
        date: "2026-11-20",
        source: "snapshot" as const,
        frames: 10,
      })),
    );
    renderBand();
    fireEvent.click(screen.getByTestId("paper-order-replay"));

    const errorBox = await screen.findByTestId("paper-order-error");
    expect(errorBox).toHaveTextContent("No recorded history for RELIANCE");
    expect(errorBox).toHaveTextContent("3 other symbols have it");
    // The individual symbols are summarised by count, never listed.
    expect(errorBox).not.toHaveTextContent("BANKNIFTY");
    expect(errorBox).not.toHaveTextContent("RELIANCE-X");
    expect(previewMock).not.toHaveBeenCalled();
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });

  it("still previews with the fallback when session discovery fails", async () => {
    pinClock();
    sessionsMock.mockRejectedValueOnce(new Error("Failed to fetch replay sessions (HTTP 500)"));
    renderBand();
    fireEvent.click(screen.getByTestId("paper-order-replay"));

    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1));
    expect(previewMock.mock.calls[0][0].entryTs).toBe("2026-11-16T09:15:00+05:30");
    await waitFor(() => expect(routerMocks.navigate).toHaveBeenCalled());
    expect(screen.queryByTestId("paper-order-error")).not.toBeInTheDocument();
  });

  it("surfaces a readable inline error when the preview returns HTTP 400", async () => {
    sessionsMock.mockResolvedValueOnce([
      { underlying: "RELIANCE", expiry: "2026-11-26", date: "2026-11-20", source: "snapshot", frames: 12 },
    ]);
    previewMock.mockRejectedValueOnce(
      new Error(
        "Failed to preview option paper order (HTTP 400): entryTs: no chain snapshot for RELIANCE 2026-11-23 at 2026-11-16T09:15:00+05:30",
      ),
    );
    renderBand();
    fireEvent.click(screen.getByTestId("paper-order-replay"));

    await waitFor(() =>
      expect(screen.getByTestId("paper-order-error")).toHaveTextContent("HTTP 400"),
    );
    expect(screen.getByTestId("paper-order-error")).toHaveTextContent("no chain snapshot");
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });

  it("disables both actions while a request is in flight", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof placeOptionPaperOrder>>) => void;
    placeMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    renderBand();
    fireEvent.click(screen.getByTestId("paper-order-place"));

    await screen.findByTestId("paper-order-loading");
    expect(screen.getByTestId("paper-order-place")).toBeDisabled();
    expect(screen.getByTestId("paper-order-replay")).toBeDisabled();

    resolve({ dryRun: false, position: position(), replay: null });
    await waitFor(() => expect(screen.getByTestId("paper-order-place")).not.toBeDisabled());
  });
});

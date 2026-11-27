// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { showSuccess } from "@/ui/notifications";
import { AddLegDialog } from "./AddLegDialog";
import { addOptionPaperLeg } from "@/api/optionsPaper";
import { getOptionsPaperState, resetOptionsPaper, setPositions } from "@/state/optionsPaper";
import type { OptionPaperLeg, OptionPaperPosition } from "@/types/optionsPaper";

vi.mock("@/api/optionsPaper", () => ({ addOptionPaperLeg: vi.fn() }));
vi.mock("@/ui/notifications", () => ({ showSuccess: vi.fn(), showError: vi.fn() }));

const addMock = vi.mocked(addOptionPaperLeg);

function leg(id: number, strike: number): OptionPaperLeg {
  return {
    id,
    positionId: 1,
    action: "BUY",
    optType: "CE",
    strike,
    lots: 1,
    qty: 75,
    instrumentKey: `NSE_FO|${strike}CE`,
    entryPremium: 6,
    markPremium: 7,
    markTs: null,
    exitPremium: null,
  };
}

function position(legs: OptionPaperLeg[] = [leg(10, 82.5)]): OptionPaperPosition {
  return {
    id: 1,
    uuid: "pos-1",
    userId: 3,
    source: "live",
    status: "open",
    underlying: "RELIANCE",
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
    legs,
    unrealizedPnl: 75,
    totalPnl: 75,
    markSpot: 84,
    markTs: null,
    dte: 4,
    createdAt: "2026-11-17T09:15:00+05:30",
    updatedAt: "2026-11-22T09:15:00+05:30",
  };
}

function fullPosition(): OptionPaperPosition {
  return position([0, 1, 2, 3].map((index) => leg(index + 1, 80 + index)));
}

function renderDialog(pos: OptionPaperPosition, onClose = vi.fn()) {
  return {
    onClose,
    ...render(() => (
      <UIProvider>
        <AddLegDialog opened position={pos} onClose={onClose} />
      </UIProvider>
    )),
  };
}

function setSelect(testId: string, value: string) {
  fireEvent.input(within(screen.getByTestId(testId)).getByRole("combobox"), { target: { value } });
}

function setNumber(testId: string, value: string) {
  fireEvent.input(screen.getByTestId(`${testId}-input`), { target: { value } });
}

beforeEach(() => {
  resetOptionsPaper();
  setPositions([position()]);
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("AddLegDialog", () => {
  it("renders all fields and the existing structure as chips", () => {
    renderDialog(position());

    expect(screen.getByTestId("add-leg-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("add-leg-action")).toBeInTheDocument();
    expect(screen.getByTestId("add-leg-opt")).toBeInTheDocument();
    expect(screen.getByTestId("add-leg-strike")).toBeInTheDocument();
    expect(screen.getByTestId("add-leg-lots")).toBeInTheDocument();
    expect(screen.getByTestId("add-leg-submit")).toBeInTheDocument();
    expect(screen.getByTestId("add-leg-existing")).toHaveTextContent("BUY CE 82.5");
    expect((screen.getByTestId("add-leg-entry-time") as HTMLInputElement).value).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
    );
  });

  it("uses 16px padding with grouped sections and 11px validation text", async () => {
    renderDialog(position());
    const body = screen.getByTestId("add-leg-dialog").querySelector('[style*="padding"]') as HTMLElement | null;
    expect(body?.style.padding).toBe("16px");

    expect(screen.getByTestId("add-leg-existing").className).toContain("gap-1");
    expect(screen.getByTestId("add-leg-section-leg").className).toContain("border-fin-border-subtle");
    expect(screen.getByTestId("add-leg-section-entry").className).toContain("border-fin-border-subtle");

    setNumber("add-leg-strike", "0");
    fireEvent.click(screen.getByTestId("add-leg-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("add-leg-error").innerHTML).toContain("text-ui-micro");
    });
  });

  it("rejects a duplicate action/opt/strike before calling the API", async () => {
    renderDialog(position());
    setNumber("add-leg-strike", "82.5");

    fireEvent.click(screen.getByTestId("add-leg-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("add-leg-error")).toHaveTextContent("already exists"),
    );
    expect(addMock).not.toHaveBeenCalled();
  });

  it("blocks a fifth leg", async () => {
    renderDialog(fullPosition());
    setNumber("add-leg-strike", "99");

    fireEvent.click(screen.getByTestId("add-leg-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("add-leg-error")).toHaveTextContent("at most 4 legs"),
    );
    expect(addMock).not.toHaveBeenCalled();
  });

  it("rejects a non-positive strike and sub-one lots", async () => {
    renderDialog(position());
    setNumber("add-leg-strike", "0");

    fireEvent.click(screen.getByTestId("add-leg-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("add-leg-error")).toHaveTextContent("Strike must be greater than zero"),
    );

    setNumber("add-leg-strike", "100");
    setNumber("add-leg-lots", "0");
    fireEvent.click(screen.getByTestId("add-leg-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("add-leg-error")).toHaveTextContent("Lots must be at least 1"),
    );
    expect(addMock).not.toHaveBeenCalled();
  });

  it("posts the chosen IST entry timestamp, upserts and closes", async () => {
    const pos = position();
    const updated = position([...pos.legs, leg(11, 100)]);
    addMock.mockResolvedValueOnce(updated);
    const onClose = vi.fn();
    renderDialog(pos, onClose);

    setSelect("add-leg-action", "SELL");
    setSelect("add-leg-opt", "PE");
    setNumber("add-leg-strike", "100");
    setNumber("add-leg-lots", "2");
    fireEvent.input(screen.getByTestId("add-leg-entry-time"), {
      target: { value: "2026-11-20T10:30" },
    });

    fireEvent.click(screen.getByTestId("add-leg-submit"));

    await waitFor(() => expect(addMock).toHaveBeenCalledTimes(1));
    expect(addMock.mock.calls[0][0]).toBe(1);
    expect(addMock.mock.calls[0][1]).toEqual({
      action: "SELL",
      opt: "PE",
      strike: 100,
      lots: 2,
      entryTs: "2026-11-20T10:30+05:30",
    });
    await waitFor(() => expect(getOptionsPaperState().positions[0].legs).toHaveLength(2));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders an API failure inline and keeps the dialog open", async () => {
    addMock.mockRejectedValueOnce(new Error("Failed to add option leg (HTTP 422): bad leg"));
    const onClose = vi.fn();
    renderDialog(position(), onClose);
    setNumber("add-leg-strike", "100");

    fireEvent.click(screen.getByTestId("add-leg-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("add-leg-error")).toHaveTextContent("HTTP 422"),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(getOptionsPaperState().positions[0].legs).toHaveLength(1);
  });

  it("shows a loading state while the request is in flight", async () => {
    let resolve!: (value: OptionPaperPosition) => void;
    addMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    renderDialog(position());
    setNumber("add-leg-strike", "100");

    fireEvent.click(screen.getByTestId("add-leg-submit"));

    expect(await screen.findByTestId("add-leg-loading")).toBeInTheDocument();
    expect(screen.getByTestId("add-leg-submit")).toBeDisabled();

    resolve(position());
    await waitFor(() => expect(screen.queryByTestId("add-leg-loading")).not.toBeInTheDocument());
  });

  it("detects a duplicate even when the fetched leg uses lowercase text or a numeric string strike", async () => {
    const malformedLeg = {
      ...leg(10, 82.5),
      action: "buy" as unknown as OptionPaperLeg["action"],
      optType: "ce" as unknown as OptionPaperLeg["optType"],
      strike: "82.5" as unknown as number,
    };
    renderDialog(position([malformedLeg]));
    setNumber("add-leg-strike", "82.5");

    fireEvent.click(screen.getByTestId("add-leg-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("add-leg-error")).toHaveTextContent("already exists"),
    );
    expect(addMock).not.toHaveBeenCalled();
  });

  it("allows the same strike with the opposite action", async () => {
    addMock.mockResolvedValueOnce(position([leg(10, 82.5), { ...leg(11, 82.5), action: "SELL" }]));
    renderDialog(position());
    setSelect("add-leg-action", "SELL");
    setNumber("add-leg-strike", "82.5");

    fireEvent.click(screen.getByTestId("add-leg-submit"));

    await waitFor(() => expect(addMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("add-leg-error")).not.toBeInTheDocument();
  });

  it("does not keep stale inputs when the parent swaps the position while open", () => {
    const [pos, setPos] = createSignal(position());
    render(() => (
      <UIProvider>
        <AddLegDialog opened position={pos()} onClose={() => {}} />
      </UIProvider>
    ));
    setNumber("add-leg-strike", "777");
    expect((screen.getByTestId("add-leg-strike-input") as HTMLInputElement).value).toBe("777");

    setPos(position([leg(20, 999)]));

    expect((screen.getByTestId("add-leg-strike-input") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("add-leg-lots-input") as HTMLInputElement).value).toBe("1");
  });

  it("rejects a malformed position without throwing", async () => {
    const broken = { ...position(), legs: undefined as unknown as OptionPaperLeg[] };
    renderDialog(broken);
    setNumber("add-leg-strike", "100");

    fireEvent.click(screen.getByTestId("add-leg-submit"));

    await waitFor(() => expect(screen.getByTestId("add-leg-error")).toBeInTheDocument());
    expect(addMock).not.toHaveBeenCalled();
  });

  it("reports the server leg count from the response, not stale props", async () => {
    const response = position([leg(1, 80), leg(2, 90), leg(3, 100)]);
    addMock.mockResolvedValueOnce(response);
    renderDialog(position());
    setNumber("add-leg-strike", "100");

    fireEvent.click(screen.getByTestId("add-leg-submit"));

    await waitFor(() =>
      expect(showSuccess).toHaveBeenCalledWith("Leg added", expect.stringContaining("3 legs")),
    );
  });
});

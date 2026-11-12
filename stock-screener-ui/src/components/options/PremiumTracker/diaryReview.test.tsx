// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { DiaryStrip } from "./DiaryStrip";
import { setupBrowserMocks } from "../../../test-utils/setupBrowser";

vi.mock("@/ui", async (importOriginal) => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  const actual = await importOriginal<typeof import("@/ui")>();
  return mockSolidUi(actual);
});
import type { PaperTrade } from "./paperTrades";

const trade: PaperTrade = {
  id: "t1",
  date: new Date().toISOString().slice(0, 10),
  underlying: "NIFTY",
  side: "CE",
  strike: 23150,
  qty: 65,
  entry: 90,
  exit: 135,
  note: "Long Call",
  conviction: "HIGH",
  plan: "morning breakout",
  review: "",
};

const props = {
  trades: [trade],
  onSetExit: vi.fn(),
  onDelete: vi.fn(),
  onUpdateTrade: vi.fn(),
};

beforeEach(() => setupBrowserMocks());
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DiaryStrip review", () => {
  it("shows conviction and opens the revisit editor", async () => {
    render(() => <DiaryStrip {...props} />);
    expect(screen.getByText("HIGH")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("diary-review-t1"));
    expect(screen.getByTestId("diary-review-panel-t1")).toBeInTheDocument();
    expect(screen.getByTestId("diary-plan-t1")).toHaveTextContent("morning breakout");
  });

  it("saves what happened and what went wrong", async () => {
    render(() => <DiaryStrip {...props} />);
    fireEvent.click(screen.getByTestId("diary-review-t1"));
    fireEvent.input(screen.getByTestId("diary-review-text-t1"), {
      target: { value: "Chopped till noon then ran without me" },
    });
    fireEvent.click(screen.getByTestId("diary-review-save-t1"));
    expect(props.onUpdateTrade).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ review: "Chopped till noon then ran without me" }),
    );
  });
});

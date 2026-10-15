// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { DiaryStrip } from "./DiaryStrip";
import { setupBrowserMocks } from "../../../test-utils/setupBrowser";
import { renderWithProviders } from "../../../test-utils/renderWithProviders";
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
    renderWithProviders(<DiaryStrip {...props} />);
    expect(screen.getByText("HIGH")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("diary-review-t1"));
    expect(screen.getByTestId("diary-review-panel-t1")).toBeInTheDocument();
    expect(screen.getByTestId("diary-plan-t1")).toHaveTextContent("morning breakout");
  });

  it("saves what happened and what went wrong", async () => {
    renderWithProviders(<DiaryStrip {...props} />);
    await userEvent.click(screen.getByTestId("diary-review-t1"));
    await userEvent.type(
      screen.getByTestId("diary-review-text-t1"),
      "Chopped till noon then ran without me",
    );
    await userEvent.click(screen.getByTestId("diary-review-save-t1"));
    expect(props.onUpdateTrade).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ review: "Chopped till noon then ran without me" }),
    );
  });
});

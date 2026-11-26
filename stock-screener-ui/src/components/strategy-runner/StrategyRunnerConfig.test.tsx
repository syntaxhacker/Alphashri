// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { StrategyRunnerConfig } from "./StrategyRunnerConfig";

vi.mock("../../api/symbols", () => ({ searchSymbols: vi.fn().mockResolvedValue([]) }));
vi.mock("../replay/ScreenerSymbolPicker", () => ({
  ScreenerSymbolPicker: () => <div data-testid="symbol-picker-mock" />,
}));

const baseProps = {
  config: { bot_uuids: [], date: "", end_date: "", symbols: [] },
  bots: [],
  isRunning: false,
  progress: { currentBot: 0, totalBots: 0, currentBotName: "" },
  setConfig: vi.fn(),
  loadBots: vi.fn().mockResolvedValue(undefined),
  startRunner: vi.fn(),
  stopRunner: vi.fn(),
  reset: vi.fn(),
};

function mount(overrides: Partial<typeof baseProps> = {}) {
  return render(() => (
    <UIProvider>
      <StrategyRunnerConfig {...baseProps} {...overrides} />
    </UIProvider>
  ));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StrategyRunnerConfig date labels", () => {
  it("renders exactly one input-attached label for each date, with no floating duplicates", () => {
    mount();
    const from = screen.getAllByText("From");
    const to = screen.getAllByText("To");
    expect(from).toHaveLength(1);
    expect(to).toHaveLength(1);
    // The surviving label belongs to the date input, not a phantom row above it.
    expect(from[0].tagName).toBe("LABEL");
    expect(to[0].tagName).toBe("LABEL");
    expect(from[0]).toHaveAttribute("for", screen.getAllByLabelText("From")[0].id);
  });

  it("keeps the honest no-bot state (Run disabled, no watchlist shortcut)", () => {
    mount();
    expect(screen.getByTestId("sr-run-btn")).toBeDisabled();
    expect(screen.queryByText("ALL")).not.toBeInTheDocument();
    expect(screen.getByTestId("symbol-picker-mock")).toBeInTheDocument();
  });
});

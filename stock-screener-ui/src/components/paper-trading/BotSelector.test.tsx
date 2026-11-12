// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { createSignal } from "solid-js";
import { render, screen, within, fireEvent, cleanup } from "@solidjs/testing-library";
import { BotSelector } from "./BotSelector";
import type { BotSummary } from "../../types/paperTrading";
import { BORDER_COLOR, POSITIVE_COLOR } from "@/ui/palette";

const { mockIsMarketClosedToday } = vi.hoisted(() => ({
  mockIsMarketClosedToday: vi.fn().mockReturnValue(false),
}));

const holidayListeners = new Set<() => void>();

vi.mock("../../state/holidays", () => ({
  subscribeToHolidays: vi.fn((cb: () => void) => {
    holidayListeners.add(cb);
    return () => holidayListeners.delete(cb);
  }),
  getHolidayState: vi.fn(() => ({ loaded: true, loading: false, holidays: [], tradingDates: new Set(), clearingDates: new Set() })),
  isMarketClosedToday: mockIsMarketClosedToday,
}));

function notifyHolidays() {
  for (const cb of [...holidayListeners]) cb();
}

const runningBot: BotSummary = {
  id: "1",
  name: "ORB Bot",
  running: true,
  pid: 12345,
  is_active: true,
  live_trading: false,
  status: "running",
  position_count: 2,
  strategies: [],
};

const stoppedBot: BotSummary = {
  id: "2",
  name: "SR Bot",
  running: false,
  pid: null,
  is_active: true,
  live_trading: false,
  status: "stopped",
  position_count: 5,
  strategies: [],
};

const runningNoPidBot: BotSummary = {
  id: "3",
  name: "No PID Bot",
  running: true,
  pid: null,
  is_active: true,
  live_trading: false,
  status: "running",
  position_count: 1,
  strategies: [],
};

beforeEach(() => {
  mockIsMarketClosedToday.mockReturnValue(false);
});

afterEach(() => {
  holidayListeners.clear();
  cleanup();
  vi.clearAllMocks();
});

describe("BotSelector", () => {
  test("returns null when bots array is empty", () => {
    render(() => (
      <BotSelector
        bots={[]}
        selectedBotId={null}
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));
    expect(screen.queryByTestId("bot-selector")).toBeNull();
  });

  test("renders dropdown with bot options showing name and position count", () => {
    render(() => (
      <BotSelector
        bots={[runningBot, stoppedBot]}
        selectedBotId={null}
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));
    expect(screen.getByTestId("bot-selector")).toBeInTheDocument();
    expect(screen.getByText("Bot:")).toBeInTheDocument();
    expect(screen.getByTestId("bot-select")).toBeInTheDocument();
    expect(screen.getByText("Select bot")).toBeInTheDocument();
  });

  test("shows running indicator with green dot and Running text", () => {
    render(() => (
      <BotSelector
        bots={[runningBot]}
        selectedBotId="1"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));
    expect(screen.getByTestId("bot-status")).toHaveTextContent("Running");
    expect(screen.getByTestId("stop-bot-btn")).toBeInTheDocument();
  });

  test("shows stopped indicator with gray dot and Stopped text", () => {
    render(() => (
      <BotSelector
        bots={[stoppedBot]}
        selectedBotId="2"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));
    expect(screen.getByTestId("bot-status")).toHaveTextContent("Stopped");
    expect(screen.getByTestId("start-bot-btn")).toBeInTheDocument();
  });

  test('shows Running when running but no pid', () => {
    render(() => (
      <BotSelector
        bots={[runningNoPidBot]}
        selectedBotId="3"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));
    expect(screen.getByTestId("bot-status")).toHaveTextContent("Running");
  });

  test("calls onSelectBot when dropdown changes", () => {
    const onSelectBot = vi.fn();
    render(() => (
      <BotSelector
        bots={[runningBot, stoppedBot]}
        selectedBotId={null}
        onSelectBot={onSelectBot}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));
    fireEvent.input(within(screen.getByTestId("bot-select")).getByRole("combobox"), { target: { value: "1" } });
    expect(onSelectBot).toHaveBeenCalledWith("1");
  });

  test("calls onToggleBot when Stop button clicked", () => {
    const onToggleBot = vi.fn();
    render(() => (
      <BotSelector
        bots={[runningBot]}
        selectedBotId="1"
        onSelectBot={vi.fn()}
        onToggleBot={onToggleBot}
        onRefresh={vi.fn()}
      />
    ));
    fireEvent.click(screen.getByTestId("stop-bot-btn"));
    expect(onToggleBot).toHaveBeenCalledTimes(1);
  });

  test("calls onToggleBot when Start button clicked", () => {
    const onToggleBot = vi.fn();
    render(() => (
      <BotSelector
        bots={[stoppedBot]}
        selectedBotId="2"
        onSelectBot={vi.fn()}
        onToggleBot={onToggleBot}
        onRefresh={vi.fn()}
      />
    ));
    fireEvent.click(screen.getByTestId("start-bot-btn"));
    expect(onToggleBot).toHaveBeenCalledTimes(1);
  });

  test("shows loading state on refresh button during refresh", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(() => (
      <BotSelector
        bots={[runningBot]}
        selectedBotId="1"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={onRefresh}
      />
    ));
    const refreshBtn = screen.getByTestId("refresh-btn");
    fireEvent.click(refreshBtn);
    await vi.waitFor(() => expect(refreshBtn).toHaveAttribute("data-loading"));
  });

  test("start button disabled when market is closed", () => {
    mockIsMarketClosedToday.mockReturnValue(true);
    render(() => (
      <BotSelector
        bots={[stoppedBot]}
        selectedBotId="2"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));
    expect(screen.getByTestId("start-bot-btn")).toBeDisabled();
  });

  test("start button shows tooltip when market closed", async () => {
    mockIsMarketClosedToday.mockReturnValue(true);
    render(() => (
      <BotSelector
        bots={[stoppedBot]}
        selectedBotId="2"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));
    const startBtn = screen.getByTestId("start-bot-btn");
    // The Solid Tooltip wraps its child in an element that carries the aria-label; hover that node.
    const tooltipWrap = startBtn.closest('[aria-label="Market closed — cannot start bot"]') as HTMLElement;
    fireEvent.mouseEnter(tooltipWrap);
    expect(await screen.findByText("Market closed — cannot start bot")).toBeInTheDocument();
  });

  test("start button not disabled when market open", () => {
    mockIsMarketClosedToday.mockReturnValue(false);
    render(() => (
      <BotSelector
        bots={[stoppedBot]}
        selectedBotId="2"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));
    expect(screen.getByTestId("start-bot-btn")).not.toBeDisabled();
  });

  test("refresh button disabled when no bot selected", () => {
    render(() => (
      <BotSelector
        bots={[runningBot]}
        selectedBotId={null}
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));
    expect(screen.getByTestId("refresh-btn")).toBeDisabled();
  });

  test("indicator dot uses gray-4 when no bot selected", () => {
    render(() => (
      <BotSelector
        bots={[runningBot]}
        selectedBotId={null}
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));
    const dot = screen.getByTestId("bot-status-dot");
    expect(dot).toBeInTheDocument();
    expect(dot?.getAttribute("style")?.toLowerCase()).toContain(BORDER_COLOR.toLowerCase());
  });

  test("indicator dot uses green-6 when bot running", () => {
    render(() => (
      <BotSelector
        bots={[runningBot]}
        selectedBotId="1"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));
    const dot = screen.getByTestId("bot-status-dot");
    expect(dot).toBeInTheDocument();
    expect(dot?.getAttribute("style")?.toLowerCase()).toContain(POSITIVE_COLOR.toLowerCase());
  });

  test("getBotLabel formats bot label with name and position count", async () => {
    render(() => (
      <BotSelector
        bots={[runningBot, stoppedBot]}
        selectedBotId={null}
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));
    fireEvent.click(within(screen.getByTestId("bot-select")).getByRole("combobox"));
    expect(await screen.findByText("ORB Bot (2 pos)")).toBeInTheDocument();
    expect(await screen.findByText("SR Bot (5 pos)")).toBeInTheDocument();
  });

  test("shows Stopped status when no bot selected", () => {
    render(() => (
      <BotSelector
        bots={[runningBot, stoppedBot]}
        selectedBotId={null}
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));
    expect(screen.getByTestId("bot-status")).toHaveTextContent("Stopped");
    expect(screen.getByTestId("start-bot-btn")).toBeDisabled();
  });

  test("handleRefresh uses setTimeout to clear loading state", async () => {
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(() => (
      <BotSelector
        bots={[runningBot]}
        selectedBotId="1"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={onRefresh}
      />
    ));
    const refreshBtn = screen.getByTestId("refresh-btn");
    fireEvent.click(refreshBtn);
    expect(refreshBtn).toHaveAttribute("data-loading");
    await vi.waitFor(() => {
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 500);
    });
    setTimeoutSpy.mockRestore();
  });

  test("double click during refresh does not call onRefresh twice", async () => {
    let resolveRefresh!: () => void;
    const refreshPromise = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    const onRefresh = vi.fn().mockReturnValue(refreshPromise);
    render(() => (
      <BotSelector
        bots={[runningBot]}
        selectedBotId="1"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={onRefresh}
      />
    ));
    const refreshBtn = screen.getByTestId("refresh-btn");
    fireEvent.click(refreshBtn);
    await vi.waitFor(() => {
      expect(refreshBtn).toHaveAttribute("data-loading");
    });
    // loading buttons get pointer-events:none — dispatch directly to simulate the guarded second click
    fireEvent.click(refreshBtn);
    resolveRefresh();
    await vi.waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  test("renders bot with zero positions in dropdown", async () => {
    const zeroPosBot: BotSummary = { ...stoppedBot, id: "10", name: "Zero Pos Bot", position_count: 0 };
    render(() => (
      <BotSelector
        bots={[zeroPosBot]}
        selectedBotId={null}
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));
    fireEvent.click(within(screen.getByTestId("bot-select")).getByRole("combobox"));
    expect(await screen.findByText("Zero Pos Bot (0 pos)")).toBeInTheDocument();
  });

  test("running bot with pid=0 shows Running without crashing", () => {
    render(() => (
      <BotSelector
        bots={[{ ...runningBot, id: "6", pid: 0 }]}
        selectedBotId="6"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));
    expect(screen.getByTestId("bot-status")).toHaveTextContent("Running");
  });

  test("renders all options with 10+ bots", async () => {
    const manyBots = Array.from({ length: 12 }, (_, i) => ({
      ...stoppedBot,
      id: String(i + 1),
      name: `Bot ${i + 1}`,
      position_count: i,
    }));
    render(() => (
      <BotSelector
        bots={manyBots}
        selectedBotId={null}
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));
    fireEvent.click(within(screen.getByTestId("bot-select")).getByRole("combobox"));
    for (let i = 0; i < 12; i++) {
      expect(await screen.findByText(`Bot ${i + 1} (${i} pos)`)).toBeInTheDocument();
    }
  });

  test("selecting the same bot again does not call onSelectBot", async () => {
    const onSelectBot = vi.fn();
    render(() => (
      <BotSelector
        bots={[runningBot, stoppedBot]}
        selectedBotId="1"
        onSelectBot={onSelectBot}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));
    fireEvent.click(within(screen.getByTestId("bot-select")).getByRole("combobox"));
    const orbOption = await screen.findByRole("option", { name: "ORB Bot (2 pos)" });
    fireEvent.click(orbOption);
    expect(onSelectBot).not.toHaveBeenCalled();
  });

  test("rapid start button clicks all call onToggleBot (parent manages debounce)", () => {
    const onToggleBot = vi.fn();
    render(() => (
      <BotSelector
        bots={[stoppedBot]}
        selectedBotId="2"
        onSelectBot={vi.fn()}
        onToggleBot={onToggleBot}
        onRefresh={vi.fn()}
      />
    ));
    const startBtn = screen.getByTestId("start-bot-btn");
    fireEvent.click(startBtn);
    fireEvent.click(startBtn);
    fireEvent.click(startBtn);
    expect(onToggleBot).toHaveBeenCalledTimes(3);
  });

  test("updates status display when bot pid changes while running", () => {
    const [bots, setBots] = createSignal([{ ...runningBot, pid: 12345 }]);
    render(() => (
      <BotSelector
        bots={bots()}
        selectedBotId="1"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));
    expect(screen.getByTestId("bot-status")).toHaveTextContent("Running");
    setBots([{ ...runningBot, pid: 67890 }]);
    expect(screen.getByTestId("bot-status")).toHaveTextContent("Running");
  });

  test("start button reflects market open/close transitions", () => {
    mockIsMarketClosedToday.mockReturnValue(false);
    render(() => (
      <BotSelector
        bots={[stoppedBot]}
        selectedBotId="2"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />
    ));
    expect(screen.getByTestId("start-bot-btn")).not.toBeDisabled();
    mockIsMarketClosedToday.mockReturnValue(true);
    notifyHolidays();
    expect(screen.getByTestId("start-bot-btn")).toBeDisabled();
  });
});

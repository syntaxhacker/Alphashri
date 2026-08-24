// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BotSelector } from "./BotSelector";
import type { BotSummary } from "../../types/paperTrading";
import { renderWithMantine } from "../../test-utils/renderWithMantine";

const { mockIsMarketClosedToday } = vi.hoisted(() => ({
  mockIsMarketClosedToday: vi.fn().mockReturnValue(false),
}));

vi.mock("../../hooks/useStoreSubscription", () => ({
  useStoreSubscription: vi.fn(),
}));

vi.mock("../../state/holidays", () => ({
  subscribeToHolidays: vi.fn(),
  isMarketClosedToday: mockIsMarketClosedToday,
}));

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
  cleanup();
  vi.clearAllMocks();
});

describe("BotSelector", () => {
  test("returns null when bots array is empty", () => {
    renderWithMantine(
      <BotSelector
        bots={[]}
        selectedBotId={null}
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("bot-selector")).toBeNull();
  });

  test("renders dropdown with bot options showing name and position count", () => {
    renderWithMantine(
      <BotSelector
        bots={[runningBot, stoppedBot]}
        selectedBotId={null}
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByTestId("bot-selector")).toBeInTheDocument();
    expect(screen.getByText("Bot:")).toBeInTheDocument();
    expect(screen.getByTestId("bot-select")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Select bot")).toBeInTheDocument();
  });

  test("shows running indicator with green dot and Running (PID X) text", () => {
    renderWithMantine(
      <BotSelector
        bots={[runningBot]}
        selectedBotId="1"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByTestId("bot-status")).toHaveTextContent("Running (PID 12345)");
    expect(screen.getByTestId("stop-bot-btn")).toBeInTheDocument();
  });

  test("shows stopped indicator with gray dot and Stopped text", () => {
    renderWithMantine(
      <BotSelector
        bots={[stoppedBot]}
        selectedBotId="2"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByTestId("bot-status")).toHaveTextContent("Stopped");
    expect(screen.getByTestId("start-bot-btn")).toBeInTheDocument();
  });

  test('shows "?" in PID when running but no pid', () => {
    renderWithMantine(
      <BotSelector
        bots={[runningNoPidBot]}
        selectedBotId="3"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByTestId("bot-status")).toHaveTextContent("Running (PID ?)");
  });

  test("calls onSelectBot when dropdown changes", async () => {
    const user = userEvent.setup();
    const onSelectBot = vi.fn();
    renderWithMantine(
      <BotSelector
        bots={[runningBot, stoppedBot]}
        selectedBotId={null}
        onSelectBot={onSelectBot}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId("bot-select"));
    const option = await screen.findByText("ORB Bot (2 pos)");
    await user.click(option);
    expect(onSelectBot).toHaveBeenCalledWith("1");
  });

  test("calls onToggleBot when Stop button clicked", async () => {
    const user = userEvent.setup();
    const onToggleBot = vi.fn();
    renderWithMantine(
      <BotSelector
        bots={[runningBot]}
        selectedBotId="1"
        onSelectBot={vi.fn()}
        onToggleBot={onToggleBot}
        onRefresh={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId("stop-bot-btn"));
    expect(onToggleBot).toHaveBeenCalledTimes(1);
  });

  test("calls onToggleBot when Start button clicked", async () => {
    const user = userEvent.setup();
    const onToggleBot = vi.fn();
    renderWithMantine(
      <BotSelector
        bots={[stoppedBot]}
        selectedBotId="2"
        onSelectBot={vi.fn()}
        onToggleBot={onToggleBot}
        onRefresh={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId("start-bot-btn"));
    expect(onToggleBot).toHaveBeenCalledTimes(1);
  });

  test("shows loading state on refresh button during refresh", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderWithMantine(
      <BotSelector
        bots={[runningBot]}
        selectedBotId="1"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={onRefresh}
      />,
    );
    const refreshBtn = screen.getByTestId("refresh-btn");
    await user.click(refreshBtn);
    expect(refreshBtn).toHaveAttribute("data-loading");
  });

  test("start button disabled when market is closed", () => {
    mockIsMarketClosedToday.mockReturnValue(true);
    renderWithMantine(
      <BotSelector
        bots={[stoppedBot]}
        selectedBotId="2"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByTestId("start-bot-btn")).toBeDisabled();
  });

  test("start button shows tooltip when market closed", async () => {
    mockIsMarketClosedToday.mockReturnValue(true);
    const user = userEvent.setup();
    renderWithMantine(
      <BotSelector
        bots={[stoppedBot]}
        selectedBotId="2"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    const startBtn = screen.getByTestId("start-bot-btn");
    await user.hover(startBtn);
    expect(await screen.findByText("Market closed — cannot start bot")).toBeInTheDocument();
  });

  test("start button not disabled when market open", () => {
    mockIsMarketClosedToday.mockReturnValue(false);
    renderWithMantine(
      <BotSelector
        bots={[stoppedBot]}
        selectedBotId="2"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByTestId("start-bot-btn")).not.toBeDisabled();
  });

  test("refresh button disabled when no bot selected", () => {
    renderWithMantine(
      <BotSelector
        bots={[runningBot]}
        selectedBotId={null}
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByTestId("refresh-btn")).toBeDisabled();
  });

  test("indicator dot uses gray-4 when no bot selected", () => {
    renderWithMantine(
      <BotSelector
        bots={[runningBot]}
        selectedBotId={null}
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    const dot = screen.getByTestId("bot-selector").querySelector(
      '[style*="border-radius: 50%"]',
    );
    expect(dot).toBeInTheDocument();
    expect(dot?.getAttribute("style")).toContain("--mui-palette-divider");
  });

  test("indicator dot uses green-6 when bot running", () => {
    renderWithMantine(
      <BotSelector
        bots={[runningBot]}
        selectedBotId="1"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    const dot = screen.getByTestId("bot-selector").querySelector(
      '[style*="border-radius: 50%"]',
    );
    expect(dot?.getAttribute("style")).toContain("--mui-palette-success-main");
  });

  test("getBotLabel formats bot label with name and position count", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <BotSelector
        bots={[runningBot, stoppedBot]}
        selectedBotId={null}
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId("bot-select"));
    expect(await screen.findByText("ORB Bot (2 pos)")).toBeInTheDocument();
    expect(await screen.findByText("SR Bot (5 pos)")).toBeInTheDocument();
  });

  test("shows Stopped status when no bot selected", () => {
    renderWithMantine(
      <BotSelector
        bots={[runningBot, stoppedBot]}
        selectedBotId={null}
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByTestId("bot-status")).toHaveTextContent("Stopped");
    expect(screen.getByTestId("start-bot-btn")).toBeDisabled();
  });

  test("handleRefresh uses setTimeout to clear loading state", async () => {
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const user = userEvent.setup();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderWithMantine(
      <BotSelector
        bots={[runningBot]}
        selectedBotId="1"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={onRefresh}
      />,
    );
    const refreshBtn = screen.getByTestId("refresh-btn");
    expect(refreshBtn).not.toHaveAttribute("data-loading");
    await user.click(refreshBtn);
    expect(refreshBtn).toHaveAttribute("data-loading");
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 500);
    setTimeoutSpy.mockRestore();
  });

  test("updates status display when bot PID changes while running", () => {
    const { rerender } = renderWithMantine(
      <BotSelector
        bots={[{ ...runningBot, pid: 12345 }]}
        selectedBotId="1"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByTestId("bot-status")).toHaveTextContent("Running (PID 12345)");
    rerender(
      <BotSelector
        bots={[{ ...runningBot, pid: 67890 }]}
        selectedBotId="1"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByTestId("bot-status")).toHaveTextContent("Running (PID 67890)");
  });

  test("shows Running (PID ?) when running=true and pid=null", () => {
    renderWithMantine(
      <BotSelector
        bots={[{ ...runningBot, id: "5", pid: null }]}
        selectedBotId="5"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByTestId("bot-status")).toHaveTextContent("Running (PID ?)");
  });

  test("start button reflects market open/close transitions", () => {
    mockIsMarketClosedToday.mockReturnValue(false);
    const { rerender } = renderWithMantine(
      <BotSelector
        bots={[stoppedBot]}
        selectedBotId="2"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByTestId("start-bot-btn")).not.toBeDisabled();
    mockIsMarketClosedToday.mockReturnValue(true);
    rerender(
      <BotSelector
        bots={[stoppedBot]}
        selectedBotId="2"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByTestId("start-bot-btn")).toBeDisabled();
  });

  test("multiple rapid refresh clicks do not re-trigger while loading", async () => {
    const user = userEvent.setup();
    let resolveRefresh: () => void;
    const refreshPromise = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    const onRefresh = vi.fn().mockReturnValue(refreshPromise);
    renderWithMantine(
      <BotSelector
        bots={[runningBot]}
        selectedBotId="1"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={onRefresh}
      />,
    );
    const refreshBtn = screen.getByTestId("refresh-btn");
    await user.click(refreshBtn);
    await vi.waitFor(() => {
      expect(refreshBtn).toHaveAttribute("data-loading");
    });
    await user.click(refreshBtn);
    resolveRefresh!();
    await vi.waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  test("renders bot with zero positions in dropdown", async () => {
    const user = userEvent.setup();
    const zeroPosBot: BotSummary = { ...stoppedBot, id: "10", name: "Zero Pos Bot", position_count: 0 };
    renderWithMantine(
      <BotSelector
        bots={[zeroPosBot]}
        selectedBotId={null}
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId("bot-select"));
    expect(await screen.findByText("Zero Pos Bot (0 pos)")).toBeInTheDocument();
  });

  test("running bot with pid=0 shows Running (PID 0) without crashing", () => {
    renderWithMantine(
      <BotSelector
        bots={[{ ...runningBot, id: "6", pid: 0 }]}
        selectedBotId="6"
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByTestId("bot-status")).toHaveTextContent("Running (PID 0)");
  });

  test("renders all options with 10+ bots", async () => {
    const user = userEvent.setup();
    const manyBots = Array.from({ length: 12 }, (_, i) => ({
      ...stoppedBot,
      id: String(i + 1),
      name: `Bot ${i + 1}`,
      position_count: i,
    }));
    renderWithMantine(
      <BotSelector
        bots={manyBots}
        selectedBotId={null}
        onSelectBot={vi.fn()}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId("bot-select"));
    for (let i = 0; i < 12; i++) {
      expect(await screen.findByText(`Bot ${i + 1} (${i} pos)`)).toBeInTheDocument();
    }
  });

  test("selecting the same bot again does not call onSelectBot", async () => {
    const user = userEvent.setup();
    const onSelectBot = vi.fn();
    renderWithMantine(
      <BotSelector
        bots={[runningBot, stoppedBot]}
        selectedBotId="1"
        onSelectBot={onSelectBot}
        onToggleBot={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId("bot-select"));
    const orbOption = await screen.findByText("ORB Bot (2 pos)");
    await user.click(orbOption);
    expect(onSelectBot).not.toHaveBeenCalled();
  });

  test("rapid start button clicks all call onToggleBot (parent manages debounce)", async () => {
    const user = userEvent.setup();
    const onToggleBot = vi.fn();
    renderWithMantine(
      <BotSelector
        bots={[stoppedBot]}
        selectedBotId="2"
        onSelectBot={vi.fn()}
        onToggleBot={onToggleBot}
        onRefresh={vi.fn()}
      />,
    );
    const startBtn = screen.getByTestId("start-bot-btn");
    await user.click(startBtn);
    await user.click(startBtn);
    await user.click(startBtn);
    expect(onToggleBot).toHaveBeenCalledTimes(3);
  });
});

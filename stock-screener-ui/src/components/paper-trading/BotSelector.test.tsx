// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { createSignal } from "solid-js";
import { render, screen, within, fireEvent, cleanup } from "@solidjs/testing-library";
import { BotSelector } from "./BotSelector";
import type { BotSummary } from "../../types/paperTrading";
import { BORDER_COLOR, POSITIVE_COLOR } from "@/ui/palette";
import { fetchHolidays } from "../../api/holidays_api";
import { loadHolidays, resetHolidays } from "../../state/holidays";

// Fixed IST instants injected into the real session helper. The holiday-only
// helper stays holiday-only so the after-hours regressions fail on the old code.
const { clock } = vi.hoisted(() => ({
  clock: { now: new Date("2026-11-16T05:30:00Z") }, // Monday 11:00 IST
}));

const holidayListeners = new Set<() => void>();

vi.mock("../../api/holidays_api", () => ({
  fetchHolidays: vi.fn(async () => []),
  fetchHolidayCheck: vi.fn(),
}));

vi.mock("../../state/holidays", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../state/holidays")>();
  const istDate = (now: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  return {
    ...actual,
    subscribeToHolidays: vi.fn((cb: () => void) => {
      holidayListeners.add(cb);
      return () => holidayListeners.delete(cb);
    }),
    // Fresh snapshot each read: the component's memo compares by reference.
    getHolidayState: () => ({ ...actual.getHolidayState() }),
    isMarketClosedToday: (now?: Date) => actual.isTradingHoliday(istDate(now ?? clock.now)),
    isMarketOpenNow: (now?: Date) => actual.isMarketOpenNow(now ?? clock.now),
  };
});

function notifyHolidays() {
  for (const cb of holidayListeners) cb();
}

function setClock(utcIso: string) {
  clock.now = new Date(utcIso);
}

async function setHoliday(date: string, description: string) {
  vi.mocked(fetchHolidays).mockResolvedValueOnce([{ date, description, type: "trading" }]);
  resetHolidays();
  await loadHolidays();
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
  setClock("2026-11-16T05:30:00Z"); // Monday 11:00 IST — open
  delete (window as any).__E2E_MOCK_MARKET_OPEN__;
  vi.mocked(fetchHolidays).mockResolvedValue([]);
  resetHolidays();
});

afterEach(() => {
  holidayListeners.clear();
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
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
    setClock("2026-11-16T11:41:00Z"); // Monday 17:11 IST — after the close
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
    setClock("2026-11-16T11:41:00Z"); // Monday 17:11 IST — after the close
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
    const tooltipWrap = startBtn.closest('[aria-label^="Market closed"]') as HTMLElement;
    fireEvent.mouseEnter(tooltipWrap);
    expect(await screen.findByText(/Market closed — Closed at 15:30 IST/)).toBeInTheDocument();
  });

  test("start button not disabled when market open", () => {
    setClock("2026-11-16T05:30:00Z"); // Monday 11:00 IST — open
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
    setClock("2026-11-16T05:30:00Z"); // Monday 11:00 IST — open
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
    setClock("2026-11-16T11:41:00Z"); // Monday 17:11 IST — after the close
    notifyHolidays();
    expect(screen.getByTestId("start-bot-btn")).toBeDisabled();
  });
});

// Fixed-instant regressions: the holiday-only helper said "open" at 17:11,
// so these cases fail on the old code and pass only with the session helper.
describe("BotSelector — session guard with fixed timestamps", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const renderStopped = () => render(() => (
    <BotSelector
      bots={[stoppedBot]}
      selectedBotId="2"
      onSelectBot={vi.fn()}
      onToggleBot={vi.fn()}
      onRefresh={vi.fn()}
    />
  ));

  it("17:11 IST on a weekday disables Start", () => {
    setClock("2026-11-16T11:41:00Z"); // Monday 17:11 IST
    renderStopped();
    expect(screen.getByTestId("start-bot-btn")).toBeDisabled();
  });

  it("11:00 IST on a weekday enables Start", () => {
    setClock("2026-11-16T05:30:00Z"); // Monday 11:00 IST
    renderStopped();
    expect(screen.getByTestId("start-bot-btn")).not.toBeDisabled();
  });

  it("a holiday at 11:00 IST disables Start and keeps the holiday reason", async () => {
    setClock("2026-01-26T05:30:00Z"); // Republic Day, Monday 11:00 IST
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(clock.now);
    await setHoliday("2026-01-26", "Republic Day");
    renderStopped();
    const startBtn = screen.getByTestId("start-bot-btn");
    expect(startBtn).toBeDisabled();
    const tooltipWrap = startBtn.closest('[aria-label^="Market closed"]') as HTMLElement;
    fireEvent.mouseEnter(tooltipWrap);
    expect(await screen.findByText(/Republic Day/)).toBeInTheDocument();
  });

  it("__E2E_MOCK_MARKET_OPEN__ enables Start at 17:11 IST", () => {
    setClock("2026-11-16T11:41:00Z");
    (window as any).__E2E_MOCK_MARKET_OPEN__ = true;
    renderStopped();
    expect(screen.getByTestId("start-bot-btn")).not.toBeDisabled();
    delete (window as any).__E2E_MOCK_MARKET_OPEN__;
  });
});

describe("BotSelector at 390px", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", ((query: string) => ({
      matches: /max-width:\s*599px/.test(query),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia);
  });

  const renderNarrow = (bots = [stoppedBot]) => render(() => (
    <BotSelector
      bots={bots}
      selectedBotId={bots[0]?.id ?? null}
      onSelectBot={vi.fn()}
      onToggleBot={vi.fn()}
      onRefresh={vi.fn()}
    />
  ));

  test("keeps every testid while making controls compact", () => {
    renderNarrow();
    const selector = screen.getByTestId("bot-selector");
    expect(selector).toHaveClass("w-full", "min-w-0");
    for (const id of ["bot-select", "bot-status-dot", "bot-status", "refresh-btn", "start-bot-btn"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("refresh-btn")).toHaveAttribute("aria-label", "Refresh");
    expect(screen.getByTestId("refresh-btn").textContent).toBe("");
    expect(screen.getByTestId("start-bot-btn")).toHaveAttribute("aria-label", "Start bot");
    expect(screen.getByTestId("start-bot-btn").textContent).toBe("");
    expect(screen.getByTestId("bot-status-dot")).toHaveAttribute("aria-label", "Bot stopped");
  });

  test("uses a flexible select and an icon-only stop control when running", () => {
    renderNarrow([runningBot]);
    expect(screen.getByTestId("bot-select").parentElement).toHaveClass("min-w-0", "flex-1");
    const stop = screen.getByTestId("stop-bot-btn");
    expect(stop).toHaveAttribute("aria-label", "Stop bot");
    expect(stop.textContent).toBe("");
    expect(screen.queryByTestId("start-bot-btn")).toBeNull();
  });
});

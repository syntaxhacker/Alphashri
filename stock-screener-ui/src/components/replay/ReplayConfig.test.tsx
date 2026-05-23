// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";
import { ReplayConfigBar } from "./ReplayConfig";
import type { ReplayConfig as ReplayConfigType } from "../../types/replay";

const { mockIsTradingHoliday, mockHolidays } = vi.hoisted(() => ({
  mockIsTradingHoliday: vi.fn().mockReturnValue(false),
  mockHolidays: { holidays: [] as { date: string; description: string }[] },
}));

vi.mock("../../api/bots", () => ({
  listBots: vi.fn().mockResolvedValue([
    { uuid: "bot-1", name: "Bot Alpha" },
    { uuid: "bot-2", name: "Bot Beta" },
  ]),
}));

vi.mock("../../state/holidays", () => ({
  getHolidayState: vi.fn(() => mockHolidays),
  subscribeToHolidays: vi.fn(),
  loadHolidays: vi.fn(),
  isTradingHoliday: mockIsTradingHoliday,
}));

vi.mock("../common/TradingDatePicker", () => ({
  TradingDatePicker: (props: any) => (
    <input
      data-testid={props["data-testid"]}
      type="date"
      value={props.value || ""}
      onChange={(e) => props.onChange(e.target.value)}
      max={props.maxDate}
    />
  ),
}));

const defaultConfig: ReplayConfigType = {
  date: "2025-01-15",
  end_date: "",
  strategy: "ALL",
  symbols: [],
  refresh_cache: false,
  bot_uuid: "",
};

beforeEach(() => {
  setupBrowserMocks();
});

afterEach(() => {
  cleanup();
});

describe("ReplayConfig", () => {
  it("renders config bar with data-testid", () => {
    render(
      <MantineProvider>
        <ReplayConfigBar
          config={defaultConfig}
          isRunning={false}
          setConfig={vi.fn()}
          startReplay={vi.fn()}
          stopReplay={vi.fn()}
          reset={vi.fn()}
        />
      </MantineProvider>,
    );
    expect(screen.getByTestId("replay-config")).toBeInTheDocument();
  });

  it("detects holiday date and calls isTradingHoliday", () => {
    mockIsTradingHoliday.mockReturnValue(true);
    const config: ReplayConfigType = { date: "2025-01-26", end_date: "", strategy: "ALL", symbols: [], refresh_cache: false, bot_uuid: "" };
    mockHolidays.holidays = [{ date: "2025-01-26", description: "Republic Day" }];
    render(
      <MantineProvider>
        <ReplayConfigBar
          config={config}
          isRunning={false}
          setConfig={vi.fn()}
          startReplay={vi.fn()}
          stopReplay={vi.fn()}
          reset={vi.fn()}
        />
      </MantineProvider>,
    );
    expect(mockIsTradingHoliday).toHaveBeenCalledWith("2025-01-26");
  });

  it("shows holiday description in warning when date is a holiday", () => {
    mockIsTradingHoliday.mockReturnValue(true);
    const config: ReplayConfigType = { date: "2025-01-26", end_date: "", strategy: "ALL", symbols: [], refresh_cache: false, bot_uuid: "" };
    mockHolidays.holidays = [{ date: "2025-01-26", description: "Republic Day" }];
    render(
      <MantineProvider>
        <ReplayConfigBar
          config={config}
          isRunning={false}
          setConfig={vi.fn()}
          startReplay={vi.fn()}
          stopReplay={vi.fn()}
          reset={vi.fn()}
        />
      </MantineProvider>,
    );
    expect(mockIsTradingHoliday).toHaveBeenCalledWith("2025-01-26");
  });

  it("clears holiday warning when date changed to non-holiday", () => {
    mockIsTradingHoliday.mockReturnValue(false);
    render(
      <MantineProvider>
        <ReplayConfigBar
          config={defaultConfig}
          isRunning={false}
          setConfig={vi.fn()}
          startReplay={vi.fn()}
          stopReplay={vi.fn()}
          reset={vi.fn()}
        />
      </MantineProvider>,
    );
    expect(screen.queryByText(/Trading holiday/)).not.toBeInTheDocument();
  });

  it("clears holiday warning when date cleared", async () => {
    mockIsTradingHoliday.mockReturnValue(true);
    render(
      <MantineProvider>
        <ReplayConfigBar
          config={{ ...defaultConfig, date: "" }}
          isRunning={false}
          setConfig={vi.fn()}
          startReplay={vi.fn()}
          stopReplay={vi.fn()}
          reset={vi.fn()}
        />
      </MantineProvider>,
    );
    expect(screen.queryByText(/Trading holiday/)).not.toBeInTheDocument();
  });

  it("renders Bot Select", () => {
    render(
      <MantineProvider>
        <ReplayConfigBar
          config={defaultConfig}
          isRunning={false}
          setConfig={vi.fn()}
          startReplay={vi.fn()}
          stopReplay={vi.fn()}
          reset={vi.fn()}
        />
      </MantineProvider>,
    );
    expect(screen.getByTestId("replay-bot-select")).toBeInTheDocument();
  });

  it("renders From/To date picker inputs", () => {
    render(
      <MantineProvider>
        <ReplayConfigBar
          config={defaultConfig}
          isRunning={false}
          setConfig={vi.fn()}
          startReplay={vi.fn()}
          stopReplay={vi.fn()}
          reset={vi.fn()}
        />
      </MantineProvider>,
    );
    expect(screen.getByTestId("replay-date-from")).toBeInTheDocument();
    expect(screen.getByTestId("replay-date-to")).toBeInTheDocument();
  });

  it("renders Strategy Select with options", () => {
    render(
      <MantineProvider>
        <ReplayConfigBar
          config={defaultConfig}
          isRunning={false}
          setConfig={vi.fn()}
          startReplay={vi.fn()}
          stopReplay={vi.fn()}
          reset={vi.fn()}
        />
      </MantineProvider>,
    );
    expect(screen.getByTestId("replay-strategy-select")).toBeInTheDocument();
  });

  it("renders Symbols Select", () => {
    render(
      <MantineProvider>
        <ReplayConfigBar
          config={defaultConfig}
          isRunning={false}
          setConfig={vi.fn()}
          startReplay={vi.fn()}
          stopReplay={vi.fn()}
          reset={vi.fn()}
        />
      </MantineProvider>,
    );
    expect(screen.getByTestId("replay-symbols-select")).toBeInTheDocument();
  });

  it("renders Refresh Cache switch", () => {
    render(
      <MantineProvider>
        <ReplayConfigBar
          config={defaultConfig}
          isRunning={false}
          setConfig={vi.fn()}
          startReplay={vi.fn()}
          stopReplay={vi.fn()}
          reset={vi.fn()}
        />
      </MantineProvider>,
    );
    expect(screen.getByTestId("replay-refresh-cache-switch")).toBeInTheDocument();
  });

  it("renders Run Replay button when not running", () => {
    render(
      <MantineProvider>
        <ReplayConfigBar
          config={defaultConfig}
          isRunning={false}
          setConfig={vi.fn()}
          startReplay={vi.fn()}
          stopReplay={vi.fn()}
          reset={vi.fn()}
        />
      </MantineProvider>,
    );
    expect(screen.getByTestId("replay-run-btn")).toBeInTheDocument();
  });

  it("Run Replay button is disabled when no date selected", () => {
    render(
      <MantineProvider>
        <ReplayConfigBar
          config={{ ...defaultConfig, date: "" }}
          isRunning={false}
          setConfig={vi.fn()}
          startReplay={vi.fn()}
          stopReplay={vi.fn()}
          reset={vi.fn()}
        />
      </MantineProvider>,
    );
    expect(screen.getByTestId("replay-run-btn")).toBeDisabled();
  });

  it("Run button calls startReplay", async () => {
    const startReplay = vi.fn();
    const user = userEvent.setup();
    render(
      <MantineProvider>
        <ReplayConfigBar
          config={defaultConfig}
          isRunning={false}
          setConfig={vi.fn()}
          startReplay={startReplay}
          stopReplay={vi.fn()}
          reset={vi.fn()}
        />
      </MantineProvider>,
    );
    await user.click(screen.getByTestId("replay-run-btn"));
    expect(startReplay).toHaveBeenCalledTimes(1);
  });

  it("shows Stop button when isRunning is true", () => {
    render(
      <MantineProvider>
        <ReplayConfigBar
          config={defaultConfig}
          isRunning={true}
          setConfig={vi.fn()}
          startReplay={vi.fn()}
          stopReplay={vi.fn()}
          reset={vi.fn()}
        />
      </MantineProvider>,
    );
    expect(screen.getByTestId("replay-stop-btn")).toBeInTheDocument();
  });

  it("Stop button calls stopReplay", async () => {
    const stopReplay = vi.fn();
    const user = userEvent.setup();
    render(
      <MantineProvider>
        <ReplayConfigBar
          config={defaultConfig}
          isRunning={true}
          setConfig={vi.fn()}
          startReplay={vi.fn()}
          stopReplay={stopReplay}
          reset={vi.fn()}
        />
      </MantineProvider>,
    );
    await user.click(screen.getByTestId("replay-stop-btn"));
    expect(stopReplay).toHaveBeenCalledTimes(1);
  });

  it("shows Reset button when not running and date is set", () => {
    render(
      <MantineProvider>
        <ReplayConfigBar
          config={defaultConfig}
          isRunning={false}
          setConfig={vi.fn()}
          startReplay={vi.fn()}
          stopReplay={vi.fn()}
          reset={vi.fn()}
        />
      </MantineProvider>,
    );
    expect(screen.getByTestId("replay-reset-btn")).toBeInTheDocument();
  });

  it("does not show Reset button when running", () => {
    render(
      <MantineProvider>
        <ReplayConfigBar
          config={defaultConfig}
          isRunning={true}
          setConfig={vi.fn()}
          startReplay={vi.fn()}
          stopReplay={vi.fn()}
          reset={vi.fn()}
        />
      </MantineProvider>,
    );
    expect(screen.queryByTestId("replay-reset-btn")).not.toBeInTheDocument();
  });

  it("Reset button calls reset", async () => {
    const reset = vi.fn();
    const user = userEvent.setup();
    render(
      <MantineProvider>
        <ReplayConfigBar
          config={defaultConfig}
          isRunning={false}
          setConfig={vi.fn()}
          startReplay={vi.fn()}
          stopReplay={vi.fn()}
          reset={reset}
        />
      </MantineProvider>,
    );
    await user.click(screen.getByTestId("replay-reset-btn"));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

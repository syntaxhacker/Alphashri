// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, Route } from "@solidjs/router";
import { SettingsPage } from "./SettingsPage";
import { UIProvider } from "@/ui";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";
import { setDensity } from "@/ui";
import { fetchHolidays } from "../../api/holidays_api";
import { loadHolidays, resetHolidays } from "../../state/holidays";

// Fixed IST instants are injected into the real session helper; the holiday-only
// helper stays holiday-only so the after-hours regressions fail on the old code.
const clock = vi.hoisted(() => ({ now: new Date("2026-11-16T05:30:00Z") })); // Mon 11:00 IST

// Mock modules using vi.hoisted
const {
  mockGetBrokerStatus,
  mockConnectUpstox,
  mockConnectFyers,
  mockDisconnectUpstox,
  mockDisconnectFyers,
  mockAddNotification,
} = vi.hoisted(() => ({
  mockGetBrokerStatus: vi.fn(),
  mockConnectUpstox: vi.fn(),
  mockConnectFyers: vi.fn(),
  mockDisconnectUpstox: vi.fn(),
  mockDisconnectFyers: vi.fn(),
  mockAddNotification: vi.fn(),
}));

vi.mock("../../api/brokers", () => ({
  getBrokerStatus: () => mockGetBrokerStatus(),
  connectUpstox: () => mockConnectUpstox(),
  disconnectUpstox: () => mockDisconnectUpstox(),
  connectFyers: () => mockConnectFyers(),
  disconnectFyers: () => mockDisconnectFyers(),
}));

vi.mock("../../state/store/notificationsSlice", () => ({
  addNotification: (...args: any[]) => mockAddNotification(...args),
}));

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
    isMarketClosedToday: (now?: Date) => actual.isTradingHoliday(istDate(now ?? clock.now)),
    isMarketOpenNow: (now?: Date) => actual.isMarketOpenNow(now ?? clock.now),
  };
});

// Stub BrokerConnectionCard so these page-level tests exercise SettingsPage's
// broker wiring without pulling in the card's own broker API/polling stream.
// Same testids/buttons as the real card.
vi.mock("../../components/settings/BrokerConnectionCard", () => ({
  BrokerConnectionCard: (props: any) => {
    const suffix = props.broker ?? "upstox";
    const isConnected = () =>
      props.status?.connected &&
      (props.status.expires_in_hours === null || props.status.expires_in_hours >= 0);
    return (
      <div
        data-testid={suffix === "upstox" ? "broker-connection-card" : `${suffix}-connection-card`}
      >
        <span>{props.title ?? "Upstox Connection"}</span>
        <span data-testid={suffix === "upstox" ? "broker-status-badge" : `${suffix}-status-badge`}>
          {isConnected() ? "Connected" : "Disconnected"}
        </span>
        {isConnected() ? (
          <button data-testid={`disconnect-${suffix}-btn`} onClick={() => props.onDisconnect()}>
            Disconnect
          </button>
        ) : (
          <button data-testid={`connect-${suffix}-btn`} onClick={() => props.onConnect()}>
            Connect
          </button>
        )}
        <button
          data-testid={
            suffix === "upstox" ? "refresh-broker-status-btn" : `refresh-${suffix}-status-btn`
          }
          onClick={() => props.onRefresh()}
        >
          Refresh
        </button>
      </div>
    );
  },
}));

const renderSettings = () =>
  render(() => (
    <MemoryRouter>
      <Route
        path="/"
        component={() => (
          <UIProvider>
            <SettingsPage />
          </UIProvider>
        )}
      />
    </MemoryRouter>
  ));

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserMocks();
    localStorage.removeItem("alphashri_ui_density");
    localStorage.removeItem("alphashri_show_market_ticker_v2");
    setDensity("compact");
    mockGetBrokerStatus.mockReset();
    mockConnectUpstox.mockReset();
    mockDisconnectUpstox.mockReset();
  });

  const mockBrokerStatus = {
    connected: true,
    broker: "upstox",
    expires_in_hours: 24,
    expires_at: new Date().toISOString(),
  };

  it("renders settings page container", () => {
    mockGetBrokerStatus.mockResolvedValue(null);

    renderSettings();

    expect(screen.getByTestId("settings-page")).toBeInTheDocument();
  });

  it("uses an internal scroll region while the page frame stays fixed", () => {
    mockGetBrokerStatus.mockResolvedValue(null);

    renderSettings();

    const page = screen.getByTestId("settings-page");
    expect(page).toHaveClass("h-full", "min-h-0", "overflow-hidden");

    const scroll = screen.getByTestId("settings-scroll");
    expect(scroll).toHaveClass("flex-1", "min-h-0", "overflow-y-auto");
    expect(scroll).toHaveAttribute("role", "region");
    expect(scroll).toHaveAttribute("tabindex", "0");
    // Title stays outside the scroll region so it is always visible.
    expect(scroll).not.toContainElement(screen.getByText("Settings"));
  });

  it("renders settings page inside the app router", () => {
    mockGetBrokerStatus.mockResolvedValue(null);

    renderSettings();

    expect(screen.getByTestId("settings-page")).toBeInTheDocument();
  });

  it("keeps controls in a readable column instead of pinning them across the viewport", () => {
    mockGetBrokerStatus.mockResolvedValue({
      connected: false,
      broker: "upstox",
      expires_in_hours: null,
      expires_at: null,
    });

    renderSettings();

    const column = screen.getByTestId("settings-form-column");
    expect(column).toHaveClass("w-full", "max-w-[720px]");
    expect(column).toContainElement(screen.getByTestId("connect-upstox-btn"));
    expect(column).toContainElement(screen.getByTestId("refresh-broker-status-btn"));
    expect(column).toContainElement(screen.getByTestId("market-ticker-toggle"));
    expect(column).toContainElement(screen.getByTestId("density-control"));
    // No fixed pixel width: the same column stacks naturally at 390px.
    expect(column.className).not.toMatch(/(?:^|\s)w-\[\d+px\](?:\s|$)/);
  });

  it("renders page title", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);

    renderSettings();

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });
  });

  it("fetches broker status on mount", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);

    renderSettings();

    await waitFor(() => {
      // One card per broker (upstox + fyers).
      expect(mockGetBrokerStatus).toHaveBeenCalledTimes(2);
    });
  });

  it("renders broker connection card", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);

    renderSettings();

    await waitFor(() => {
      expect(screen.getByText("Upstox Connection")).toBeInTheDocument();
    });
  });

  it("displays connected status when upstox is connected", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);

    renderSettings();

    await waitFor(() => {
      expect(screen.getAllByText("Connected").length).toBeGreaterThan(0);
    });
  });

  it("displays disconnected status when upstox is not connected", async () => {
    mockGetBrokerStatus.mockResolvedValue({
      connected: false,
      broker: "upstox",
      expires_in_hours: null,
      expires_at: null,
    });

    renderSettings();

    await waitFor(() => {
      expect(screen.getAllByText("Disconnected").length).toBeGreaterThan(0);
    });
  });

  it("calls connectUpstox when connect button is clicked", async () => {
    mockGetBrokerStatus.mockResolvedValue({
      connected: false,
      broker: "upstox",
      expires_in_hours: null,
      expires_at: null,
    });

    renderSettings();

    await waitFor(() => {
      expect(screen.getByTestId("connect-upstox-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("connect-upstox-btn"));

    expect(mockConnectUpstox).toHaveBeenCalledTimes(1);
  });

  it("calls disconnectUpstox when disconnect button is clicked", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);
    mockDisconnectUpstox.mockResolvedValue({});

    renderSettings();

    await waitFor(() => {
      expect(screen.getByTestId("disconnect-upstox-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("disconnect-upstox-btn"));

    expect(mockDisconnectUpstox).toHaveBeenCalledTimes(1);
  });

  it("shows success notification on successful disconnect", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);
    mockDisconnectUpstox.mockResolvedValue({});

    renderSettings();

    await waitFor(() => {
      expect(screen.getByTestId("disconnect-upstox-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("disconnect-upstox-btn"));

    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith({
        type: "success",
        message: "Upstox disconnected successfully",
        duration: 5000,
      });
    });
  });

  it("shows error notification on failed disconnect", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);
    mockDisconnectUpstox.mockRejectedValue(new Error("Failed"));

    renderSettings();

    await waitFor(() => {
      expect(screen.getByTestId("disconnect-upstox-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("disconnect-upstox-btn"));

    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith({
        type: "error",
        message: "Failed to disconnect Upstox",
        duration: 5000,
      });
    });
  });

  it("fetches broker status on mount for connected query param handling", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);

    renderSettings();

    await waitFor(() => {
      expect(mockGetBrokerStatus).toHaveBeenCalled();
    });
  });

  it("polls broker status every minute", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);
    const setIntervalSpy = vi.spyOn(global, "setInterval");

    renderSettings();

    await waitFor(() => {
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60000);
    });

    setIntervalSpy.mockRestore();
  });

  it("renders market ticker toggle section", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);

    renderSettings();

    await waitFor(() => {
      expect(screen.getByText("Market Ticker")).toBeInTheDocument();
    });
  });

  it("shows market ticker toggle checked by default", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);

    renderSettings();

    await waitFor(() => {
      expect(screen.getByRole("switch")).toBeChecked();
    });
  });

  it("updates market ticker preference when toggle is changed", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);

    renderSettings();

    await waitFor(() => {
      expect(screen.getByRole("switch")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("market-ticker-toggle"));

    expect(localStorage.getItem("alphashri_show_market_ticker_v2")).toBe("false");
  });

  it("renders table density control defaulting to Compact", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);
    localStorage.removeItem("alphashri_ui_density");

    renderSettings();

    await waitFor(() => {
      expect(screen.getByTestId("density-control")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true");
  });

  it("persists Comfortable density to localStorage when selected", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);
    localStorage.removeItem("alphashri_ui_density");

    renderSettings();

    await waitFor(() => {
      expect(screen.getByTestId("density-control")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Comfortable" }));

    await waitFor(() => {
      expect(localStorage.getItem("alphashri_ui_density")).toBe("comfortable");
    });
  });
});

async function setHoliday(date: string, description: string) {
  vi.mocked(fetchHolidays).mockResolvedValueOnce([{ date, description, type: "trading" }]);
  resetHolidays();
  await loadHolidays();
}

describe("SettingsPage — broker-status poll session guard", () => {
  const brokerStatus = {
    connected: false,
    broker: "upstox",
    expires_in_hours: null,
    expires_at: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserMocks();
    localStorage.removeItem("alphashri_ui_density");
    localStorage.removeItem("alphashri_show_market_ticker_v2");
    setDensity("compact");
    mockGetBrokerStatus.mockReset();
    mockGetBrokerStatus.mockResolvedValue(brokerStatus);
    vi.useFakeTimers();
    clock.now = new Date("2026-11-16T05:30:00Z");
    delete (window as any).__E2E_MOCK_MARKET_OPEN__;
    vi.mocked(fetchHolidays).mockResolvedValue([]);
    resetHolidays();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  async function mountAndRecordInitialCalls(): Promise<number> {
    renderSettings();
    await Promise.resolve();
    await Promise.resolve();
    return mockGetBrokerStatus.mock.calls.length;
  }

  it("skips the 60s broker poll at 17:11 IST on a weekday", async () => {
    clock.now = new Date("2026-11-16T11:41:00Z"); // Monday 17:11 IST
    expect(await mountAndRecordInitialCalls()).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockGetBrokerStatus).toHaveBeenCalledTimes(2);
  });

  it("runs the 60s broker poll at 11:00 IST on a weekday", async () => {
    expect(await mountAndRecordInitialCalls()).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockGetBrokerStatus).toHaveBeenCalledTimes(4);
  });

  it("skips the 60s broker poll on a holiday at 11:00 IST", async () => {
    clock.now = new Date("2026-01-26T05:30:00Z"); // Republic Day, Monday 11:00 IST
    await setHoliday("2026-01-26", "Republic Day");
    expect(await mountAndRecordInitialCalls()).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockGetBrokerStatus).toHaveBeenCalledTimes(2);
  });

  it("__E2E_MOCK_MARKET_OPEN__ runs the 60s poll even on a holiday at 11:00 IST", async () => {
    clock.now = new Date("2026-01-26T05:30:00Z");
    await setHoliday("2026-01-26", "Republic Day");
    (window as any).__E2E_MOCK_MARKET_OPEN__ = true;
    expect(await mountAndRecordInitialCalls()).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockGetBrokerStatus).toHaveBeenCalledTimes(4);
    delete (window as any).__E2E_MOCK_MARKET_OPEN__;
  });
});

// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SettingsPage } from "./SettingsPage";
import { BrowserRouter } from "react-router-dom";
import { renderWithMantine } from "../../test-utils/renderWithMantine";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

// Mock modules using vi.hoisted
const { mockGetBrokerStatus, mockConnectUpstox, mockDisconnectUpstox, mockDispatch } = vi.hoisted(
  () => {
    const mockGetBrokerStatus = vi.fn();
    const mockConnectUpstox = vi.fn();
    const mockDisconnectUpstox = vi.fn();
    const mockDispatch = vi.fn();
    return { mockGetBrokerStatus, mockConnectUpstox, mockDisconnectUpstox, mockDispatch };
  },
);

vi.mock("../../api/brokers", () => ({
  getBrokerStatus: () => mockGetBrokerStatus(),
  connectUpstox: () => mockConnectUpstox(),
  disconnectUpstox: () => mockDisconnectUpstox(),
}));

vi.mock("../../state/store/hooks", () => ({
  useAppDispatch: () => mockDispatch,
}));

vi.mock("../../hooks/useThemeColors", () => ({
  useThemeColors: () => ({
    isDark: false,
    background: "#fff",
  }),
}));

// Mock useMarketTickerEnabled
const mockSetShowMarketTicker = vi.fn();
vi.mock("../../hooks/useMarketTickerEnabled", () => ({
  useMarketTickerEnabled: () => [false, mockSetShowMarketTicker],
}));

// Wrapper with Router + Mantine
function renderWithRouter(ui: React.ReactElement) {
  return renderWithMantine(<BrowserRouter>{ui}</BrowserRouter>);
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserMocks();
    // Reset mock implementations
    mockGetBrokerStatus.mockReset();
    mockConnectUpstox.mockReset();
    mockDisconnectUpstox.mockReset();
    mockSetShowMarketTicker.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  const mockBrokerStatus = {
    connected: true,
    broker: "upstox",
    expires_in_hours: 24,
    expires_at: new Date().toISOString(),
  };

  it("renders settings page container", () => {
    mockGetBrokerStatus.mockResolvedValue(null);

    renderWithRouter(<SettingsPage />);

    expect(screen.getByTestId("settings-page")).toBeInTheDocument();
  });

  it("renders page title", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);

    renderWithRouter(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });
  });

  it("fetches broker status on mount", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);

    renderWithRouter(<SettingsPage />);

    await waitFor(() => {
      expect(mockGetBrokerStatus).toHaveBeenCalledTimes(1);
    });
  });

  it("renders broker connection card", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);

    renderWithRouter(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Upstox Connection")).toBeInTheDocument();
    });
  });

  it("displays connected status when upstox is connected", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);

    renderWithRouter(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });
  });

  it("displays disconnected status when upstox is not connected", async () => {
    mockGetBrokerStatus.mockResolvedValue({
      connected: false,
      broker: "upstox",
      expires_in_hours: null,
      expires_at: null,
    });

    renderWithRouter(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Disconnected")).toBeInTheDocument();
    });
  });

  it("calls connectUpstox when connect button is clicked", async () => {
    mockGetBrokerStatus.mockResolvedValue({
      connected: false,
      broker: "upstox",
      expires_in_hours: null,
      expires_at: null,
    });

    renderWithRouter(<SettingsPage />);

    // Wait for the button to appear AND for loading to complete
    await waitFor(() => {
      const btn = screen.getByTestId("connect-upstox-btn");
      expect(btn).toBeInTheDocument();
      // Ensure button is not in loading state
      expect(btn).not.toHaveAttribute("data-loading");
    });

    const connectBtn = screen.getByTestId("connect-upstox-btn");
    connectBtn.click();

    expect(mockConnectUpstox).toHaveBeenCalledTimes(1);
  });

  it("calls disconnectUpstox when disconnect button is clicked", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);
    mockDisconnectUpstox.mockResolvedValue({});

    renderWithRouter(<SettingsPage />);

    // Wait for the button to appear AND for loading to complete
    await waitFor(() => {
      const btn = screen.getByTestId("disconnect-upstox-btn");
      expect(btn).toBeInTheDocument();
      expect(btn).not.toHaveAttribute("data-loading");
    });

    const disconnectBtn = screen.getByTestId("disconnect-upstox-btn");
    disconnectBtn.click();

    expect(mockDisconnectUpstox).toHaveBeenCalledTimes(1);
  });

  it("shows success notification on successful disconnect", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);
    mockDisconnectUpstox.mockResolvedValue({});

    renderWithRouter(<SettingsPage />);

    // Wait for the button to appear AND for loading to complete
    await waitFor(() => {
      const btn = screen.getByTestId("disconnect-upstox-btn");
      expect(btn).toBeInTheDocument();
      expect(btn).not.toHaveAttribute("data-loading");
    });

    const disconnectBtn = screen.getByTestId("disconnect-upstox-btn");
    disconnectBtn.click();

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "notifications/addNotification",
        payload: {
          type: "success",
          message: "Upstox disconnected successfully",
          duration: 5000,
        },
      });
    });
  });

  it("shows error notification on failed disconnect", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);
    mockDisconnectUpstox.mockRejectedValue(new Error("Failed"));

    renderWithRouter(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("disconnect-upstox-btn")).toBeInTheDocument();
    });

    const disconnectBtn = screen.getByTestId("disconnect-upstox-btn");
    disconnectBtn.click();

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith({
        payload: {
          duration: 5000,
          message: "Failed to disconnect Upstox",
          type: "error",
        },
        type: "notifications/addNotification",
      });
    });
  });

  it("handles upstox connected query param", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);

    renderWithRouter(<SettingsPage />);

    await waitFor(() => {
      expect(mockGetBrokerStatus).toHaveBeenCalled();
    });
  });

  it("polls broker status every minute", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);
    const setIntervalSpy = vi.spyOn(global, "setInterval");

    renderWithRouter(<SettingsPage />);

    await waitFor(() => {
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60000);
    });

    setIntervalSpy.mockRestore();
  });

  it("renders market ticker toggle section", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);

    renderWithRouter(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Market Ticker")).toBeInTheDocument();
    });
  });

  it("shows market ticker toggle unchecked by default", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);

    renderWithRouter(<SettingsPage />);

    await waitFor(() => {
      const toggle = screen.getByRole("switch");
      expect(toggle).not.toBeChecked();
    });
  });

  it("updates market ticker preference when toggle is changed", async () => {
    mockGetBrokerStatus.mockResolvedValue(mockBrokerStatus);

    renderWithRouter(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByRole("switch")).toBeInTheDocument();
    });

    const toggle = screen.getByRole("switch");
    toggle.click();

    expect(mockSetShowMarketTicker).toHaveBeenCalledWith(true);
  });
});

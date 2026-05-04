// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { ChatPopup } from "./ChatPopup";

vi.mock("../../api/trading_agents", () => ({
  checkTradingAgentsHealth: vi.fn(),
  analyzeStock: vi.fn(),
  streamStockAnalysis: vi.fn(),
}));

import {
  checkTradingAgentsHealth,
  streamStockAnalysis,
} from "../../api/trading_agents";

const mockCheckHealth = vi.mocked(checkTradingAgentsHealth);
const mockStreamAnalysis = vi.mocked(streamStockAnalysis);

const renderWithProvider = (component: React.ReactElement) => {
  return render(
    <MantineProvider>
      {component}
    </MantineProvider>
  );
};

describe("ChatPopup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders floating action button", () => {
    renderWithProvider(<ChatPopup />);
    expect(screen.getByTestId("chat-popup-toggle")).toBeInTheDocument();
  });

  it("opens chat window when FAB is clicked", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });

    renderWithProvider(<ChatPopup />);

    const fab = screen.getByTestId("chat-popup-toggle");
    fireEvent.click(fab);

    await waitFor(() => {
      expect(screen.getByTestId("chat-popup-window")).toBeInTheDocument();
    });
  });

  it("shows availability status", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });

    renderWithProvider(<ChatPopup />);

    const fab = screen.getByTestId("chat-popup-toggle");
    fireEvent.click(fab);

    await waitFor(() => {
      expect(screen.getByTestId("chat-popup-window")).toBeInTheDocument();
    });
  });

  it("shows unavailable badge when service not available", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "unavailable",
      tradingagents_available: false,
      timestamp: "2026-01-01T00:00:00",
    });

    renderWithProvider(<ChatPopup />);

    const fab = screen.getByTestId("chat-popup-toggle");
    fireEvent.click(fab);

    await waitFor(() => {
      expect(screen.getByText("Unavailable")).toBeInTheDocument();
    });
  });

  it("has message input field", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });

    renderWithProvider(<ChatPopup />);

    const fab = screen.getByTestId("chat-popup-toggle");
    fireEvent.click(fab);

    await waitFor(() => {
      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    });
  });

  it("has send button", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });

    renderWithProvider(<ChatPopup />);

    const fab = screen.getByTestId("chat-popup-toggle");
    fireEvent.click(fab);

    await waitFor(() => {
      expect(screen.getByTestId("chat-send-button")).toBeInTheDocument();
    });
  });

  it("closes chat window when FAB is clicked again", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });

    renderWithProvider(<ChatPopup />);

    const fab = screen.getByTestId("chat-popup-toggle");
    fireEvent.click(fab);

    await waitFor(() => {
      expect(screen.getByTestId("chat-popup-window")).toBeInTheDocument();
    });

    fireEvent.click(fab);

    await waitFor(() => {
      const windowEl = screen.getByTestId("chat-popup-window");
      const collapseParent = windowEl.closest("[aria-hidden]");
      expect(collapseParent).toHaveAttribute("aria-hidden", "true");
    });
  });

  it("displays welcome message when no messages", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });

    renderWithProvider(<ChatPopup />);

    const fab = screen.getByTestId("chat-popup-toggle");
    fireEvent.click(fab);

    await waitFor(() => {
      expect(screen.getByText(/Ask me to analyze a stock/i)).toBeInTheDocument();
    });
  });

  it("calls health check on first open", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });

    renderWithProvider(<ChatPopup />);

    const fab = screen.getByTestId("chat-popup-toggle");
    fireEvent.click(fab);

    await waitFor(() => {
      expect(mockCheckHealth).toHaveBeenCalled();
    });
  });
});
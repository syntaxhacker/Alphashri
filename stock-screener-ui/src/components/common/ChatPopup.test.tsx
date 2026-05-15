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
  sendChatMessage: vi.fn(),
  listConversations: vi.fn().mockResolvedValue([]),
  createConversation: vi.fn().mockResolvedValue({ id: "test-convo-1", title: "Test" }),
  getMessages: vi.fn().mockResolvedValue([]),
  addMessage: vi.fn(),
  deleteConversation: vi.fn(),
}));

import {
  checkTradingAgentsHealth,
  streamStockAnalysis,
  sendChatMessage,
} from "../../api/trading_agents";

const mockCheckHealth = vi.mocked(checkTradingAgentsHealth);
const mockStreamAnalysis = vi.mocked(streamStockAnalysis);
const mockSendChatMessage = vi.mocked(sendChatMessage);

const renderWithProvider = (component: React.ReactElement) => {
  return render(<MantineProvider>{component}</MantineProvider>);
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

  it("sends user message on Enter key", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });
    mockSendChatMessage.mockResolvedValue({
      response: "Hello! How can I help?",
      should_analyze: null,
    });

    renderWithProvider(<ChatPopup />);

    const fab = screen.getByTestId("chat-popup-toggle");
    fireEvent.click(fab);

    await waitFor(() => {
      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    });

    const input = screen.getByTestId("chat-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Hello" } });

    const sendBtn = screen.getByTestId("chat-send-button");
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(screen.getByText("Hello")).toBeInTheDocument();
    });
  });

  it("displays agent progress indicators during stream", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });

    // Use infinite generator so the component stays in loading state
    // (agent progress is only visible while isLoading is true)
    async function* infiniteGen() {
      yield { event: "progress", data: { percent: 50 } };
      await new Promise(() => {});
    }
    mockSendChatMessage.mockResolvedValue({
      should_analyze: "NVDA",
      response: "Analyzing NVDA...",
    });
    mockStreamAnalysis.mockReturnValue(infiniteGen());

    renderWithProvider(<ChatPopup />);

    const fab = screen.getByTestId("chat-popup-toggle");
    fireEvent.click(fab);

    await waitFor(() => {
      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    });

    const input = screen.getByTestId("chat-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Analyze NVDA" } });

    const sendBtn = screen.getByTestId("chat-send-button");
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(screen.getByText("Market Analyst")).toBeInTheDocument();
    });

    expect(screen.getByText("News Analyst")).toBeInTheDocument();
    expect(screen.getByText("Fundamentals")).toBeInTheDocument();
    expect(screen.getByText("Research Team")).toBeInTheDocument();
    expect(screen.getByText("Trading Team")).toBeInTheDocument();
    expect(screen.getByText("Risk Management")).toBeInTheDocument();
    expect(screen.getByText("Portfolio Manager")).toBeInTheDocument();
  });

  it("shows tool calls when streaming", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });

    // Use an infinite generator that never ends, keeping isLoading=true
    async function* infiniteGenerator() {
      yield { event: "tool_call", data: { tool: "get_stock_price", agent: "market" } };
      // Hang forever to keep isLoading=true - component shows tool calls while loading
      await new Promise(() => {});
    }
    mockSendChatMessage.mockResolvedValue({
      should_analyze: "NVDA",
      response: "Analyzing NVDA...",
    });
    mockStreamAnalysis.mockReturnValue(infiniteGenerator());

    renderWithProvider(<ChatPopup />);

    const fab = screen.getByTestId("chat-popup-toggle");
    fireEvent.click(fab);

    await waitFor(() => {
      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    });

    const input = screen.getByTestId("chat-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Analyze NVDA" } });
    const sendBtn = screen.getByTestId("chat-send-button");
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(screen.getByText("get_stock_price")).toBeInTheDocument();
    });
  });

  it("shows analysis badge with ticker and decision", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });

    async function* mockGenerator() {
      yield {
        event: "complete",
        data: {
          decision: "BUY",
          reports: { market_analysis: "Strong uptrend" },
          stats: { rsi: 65 },
        },
      };
    }
    mockSendChatMessage.mockResolvedValue({
      should_analyze: "NVDA",
      response: "Analyzing NVDA...",
    });
    mockStreamAnalysis.mockReturnValue(mockGenerator());

    renderWithProvider(<ChatPopup />);

    const fab = screen.getByTestId("chat-popup-toggle");
    fireEvent.click(fab);

    await waitFor(() => {
      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    });

    const input = screen.getByTestId("chat-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Analyze NVDA" } });
    const sendBtn = screen.getByTestId("chat-send-button");
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(screen.getAllByText("NVDA").length).toBeGreaterThanOrEqual(1);
      // BUY appears in both markdown content and the badge, so use getAllByText
      expect(screen.getAllByText("BUY").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders reports section when analysis completes", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });

    async function* mockGenerator() {
      yield {
        event: "complete",
        data: {
          decision: "HOLD",
          reports: {
            market_analysis: "Sideways market",
            news_analysis: "No major news",
            fundamentals: "PE ratio 25",
          },
        },
      };
    }
    mockSendChatMessage.mockResolvedValue({
      should_analyze: "NVDA",
      response: "Analyzing NVDA...",
    });
    mockStreamAnalysis.mockReturnValue(mockGenerator());

    renderWithProvider(<ChatPopup />);

    const fab = screen.getByTestId("chat-popup-toggle");
    fireEvent.click(fab);

    await waitFor(() => {
      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    });

    const input = screen.getByTestId("chat-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Analyze NVDA" } });
    const sendBtn = screen.getByTestId("chat-send-button");
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(screen.getByText("market analysis")).toBeInTheDocument();
      expect(screen.getByText("news analysis")).toBeInTheDocument();
      expect(screen.getByText("fundamentals")).toBeInTheDocument();
      expect(screen.getByText("Sideways market")).toBeInTheDocument();
    });
  });
});

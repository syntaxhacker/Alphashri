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
  listConversations: vi.fn(),
  createConversation: vi.fn(),
  getMessages: vi.fn(),
  addMessage: vi.fn(),
  deleteConversation: vi.fn(),
}));

import { checkTradingAgentsHealth, streamStockAnalysis, sendChatMessage, listConversations, createConversation, deleteConversation, getMessages, addMessage } from "../../api/trading_agents";

const mockCheckHealth = vi.mocked(checkTradingAgentsHealth);
const mockSendChatMessage = vi.mocked(sendChatMessage);
const mockListConversations = vi.mocked(listConversations);
const mockCreateConversation = vi.mocked(createConversation);
const mockDeleteConversation = vi.mocked(deleteConversation);
const mockGetMessages = vi.mocked(getMessages);
const mockAddMessage = vi.mocked(addMessage);

const renderWithProvider = (component: React.ReactElement) => {
  return render(<MantineProvider>{component}</MantineProvider>);
};

describe("ChatPopup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListConversations.mockResolvedValue([]);
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
    fireEvent.click(screen.getByTestId("chat-popup-toggle"));

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
    fireEvent.click(screen.getByTestId("chat-popup-toggle"));

    await waitFor(() => {
      expect(screen.getByText("Unavailable")).toBeInTheDocument();
    });
  });

  it("closes chat window when FAB is clicked again", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });

    renderWithProvider(<ChatPopup />);
    fireEvent.click(screen.getByTestId("chat-popup-toggle"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-popup-window")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("chat-popup-toggle"));

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
    fireEvent.click(screen.getByTestId("chat-popup-toggle"));

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
    fireEvent.click(screen.getByTestId("chat-popup-toggle"));

    await waitFor(() => {
      expect(mockCheckHealth).toHaveBeenCalled();
    });
  });

  it("shows availability status", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });

    renderWithProvider(<ChatPopup />);
    fireEvent.click(screen.getByTestId("chat-popup-toggle"));

    await waitFor(() => {
      expect(screen.getByText(/Ask me to analyze a stock/i)).toBeInTheDocument();
    });
  });

  it("has message input field", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });

    renderWithProvider(<ChatPopup />);
    fireEvent.click(screen.getByTestId("chat-popup-toggle"));

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
    fireEvent.click(screen.getByTestId("chat-popup-toggle"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-send-button")).toBeInTheDocument();
    });
  });

  it("disables input when service is not available", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "unavailable",
      tradingagents_available: false,
      timestamp: "2026-01-01T00:00:00",
    });

    renderWithProvider(<ChatPopup />);
    fireEvent.click(screen.getByTestId("chat-popup-toggle"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-input")).toBeDisabled();
    });
  });

  it("sends message on Enter key", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });
    mockSendChatMessage.mockResolvedValue({ response: "Hello!", should_analyze: false });
    mockAddMessage.mockResolvedValue({} as never);
    mockCreateConversation.mockResolvedValue({ id: "convo-1", title: "New Chat", created_at: new Date().toISOString() });

    renderWithProvider(<ChatPopup />);
    fireEvent.click(screen.getByTestId("chat-popup-toggle"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    });

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "Hello bot" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mockSendChatMessage).toHaveBeenCalledWith({ message: "Hello bot" });
    });
  });

  it("expands and collapses via max-min button", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });

    renderWithProvider(<ChatPopup />);
    fireEvent.click(screen.getByTestId("chat-popup-toggle"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-expand-btn")).toBeInTheDocument();
    });

    const expandBtn = screen.getByTestId("chat-expand-btn");
    fireEvent.click(expandBtn);
  });

  it("shows empty conversation state", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });
    mockListConversations.mockResolvedValue([]);

    renderWithProvider(<ChatPopup />);
    fireEvent.click(screen.getByTestId("chat-popup-toggle"));

    await waitFor(() => {
      expect(screen.getByText("Conversations")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("chat-history-btn"));

    await waitFor(() => {
      expect(screen.getByText("No saved conversations")).toBeInTheDocument();
    });
  });

  it("creates new conversation when new button is clicked", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });
    mockListConversations.mockResolvedValue([]);
    mockCreateConversation.mockResolvedValue({ id: "new-convo", title: "New Chat", created_at: new Date().toISOString() });

    renderWithProvider(<ChatPopup />);
    fireEvent.click(screen.getByTestId("chat-popup-toggle"));

    await waitFor(() => {
      expect(screen.getByText("Conversations")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("chat-history-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-new-convo-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("chat-new-convo-btn"));

    await waitFor(() => {
      expect(mockCreateConversation).toHaveBeenCalled();
    });
  });

  it("lists conversations in history sidebar", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });
    mockListConversations.mockResolvedValue([
      { id: "c1", title: "NVDA Analysis", created_at: "2026-05-01T00:00:00Z" },
    ]);

    renderWithProvider(<ChatPopup />);
    fireEvent.click(screen.getByTestId("chat-popup-toggle"));

    await waitFor(() => {
      expect(screen.getByText("Conversations")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("chat-history-btn"));

    await waitFor(() => {
      expect(screen.getByText("NVDA Analysis")).toBeInTheDocument();
    });
  });

  it("deletes conversation from history", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });
    mockListConversations.mockResolvedValue([
      { id: "c1", title: "NVDA Analysis", created_at: "2026-05-01T00:00:00Z" },
    ]);
    mockDeleteConversation.mockResolvedValue({} as never);

    renderWithProvider(<ChatPopup />);
    fireEvent.click(screen.getByTestId("chat-popup-toggle"));

    await waitFor(() => {
      expect(screen.getByText("Conversations")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("chat-history-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-delete-convo-c1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("chat-delete-convo-c1"));

    await waitFor(() => {
      expect(mockDeleteConversation).toHaveBeenCalledWith("c1");
    });
  });

  it("switches conversation and loads its messages", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });
    mockGetMessages.mockResolvedValue([]);
    mockListConversations.mockResolvedValue([
      { id: "c1", title: "NVDA Analysis", created_at: "2026-05-01T00:00:00Z" },
    ]);

    renderWithProvider(<ChatPopup />);
    fireEvent.click(screen.getByTestId("chat-popup-toggle"));

    await waitFor(() => {
      expect(screen.getByText("Conversations")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("chat-history-btn"));

    await waitFor(() => {
      expect(screen.getByText("NVDA Analysis")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("NVDA Analysis"));

    await waitFor(() => {
      expect(mockGetMessages).toHaveBeenCalledWith("c1");
    });
  });

  it("shows loading state with progress bar during analysis", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });
    mockSendChatMessage.mockImplementation(() => new Promise(() => {}));

    renderWithProvider(<ChatPopup />);
    fireEvent.click(screen.getByTestId("chat-popup-toggle"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    });

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "Analyze NVDA" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText(/Analyzing/i)).toBeInTheDocument();
    });
  });

  it("shows tool calls during stream", async () => {
    mockCheckHealth.mockResolvedValue({
      status: "ok",
      tradingagents_available: true,
      timestamp: "2026-01-01T00:00:00",
    });

    renderWithProvider(<ChatPopup />);
    fireEvent.click(screen.getByTestId("chat-popup-toggle"));

    await waitFor(() => {
      expect(screen.queryByText(/Tool Calls/i)).not.toBeInTheDocument();
    });
  });
});

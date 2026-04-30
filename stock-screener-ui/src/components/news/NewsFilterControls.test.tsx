// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NewsFilterControls } from "./NewsFilterControls";
import { TestWrapper } from "../../test/test-utils";

describe("NewsFilterControls", () => {
  const mockSourceData = [
    { value: "all", label: "All Sources" },
    { value: "reuters", label: "Reuters" },
    { value: "bloomberg", label: "Bloomberg" },
  ];

  const defaultProps = {
    sourceData: mockSourceData,
    selectedSource: "all",
    autoRefreshMs: "0",
    loading: false,
    isRefreshing: false,
    unreadCount: 0,
    onSourceChange: vi.fn(),
    onRefresh: vi.fn(),
    onAutoRefreshChange: vi.fn(),
    onMarkAllRead: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("rendering", () => {
    it("renders source select dropdown", () => {
      render(<NewsFilterControls {...defaultProps} />, { wrapper: TestWrapper });
      expect(screen.getByTestId("news-source-select")).toBeInTheDocument();
    });

    it("renders refresh button", () => {
      render(<NewsFilterControls {...defaultProps} />, { wrapper: TestWrapper });
      expect(screen.getByTestId("news-refresh-btn")).toBeInTheDocument();
    });

    it("renders auto-refresh select", () => {
      render(<NewsFilterControls {...defaultProps} />, { wrapper: TestWrapper });
      expect(screen.getByTestId("news-auto-refresh-select")).toBeInTheDocument();
    });

    it("shows unread badge when unreadCount > 0", () => {
      render(<NewsFilterControls {...defaultProps} unreadCount={5} />, { wrapper: TestWrapper });
      expect(screen.getByTestId("news-unread-badge")).toBeInTheDocument();
    });

    it("does not show unread badge when unreadCount is 0", () => {
      render(<NewsFilterControls {...defaultProps} unreadCount={0} />, { wrapper: TestWrapper });
      expect(screen.queryByTestId("news-unread-badge")).not.toBeInTheDocument();
    });
  });

  describe("callbacks", () => {
    it("accepts onSourceChange callback", () => {
      const onSourceChange = vi.fn();
      render(<NewsFilterControls {...defaultProps} onSourceChange={onSourceChange} />, {
        wrapper: TestWrapper,
      });
      expect(onSourceChange).not.toHaveBeenCalled();
    });

    it("accepts onAutoRefreshChange callback", () => {
      const onAutoRefreshChange = vi.fn();
      render(<NewsFilterControls {...defaultProps} onAutoRefreshChange={onAutoRefreshChange} />, {
        wrapper: TestWrapper,
      });
      expect(onAutoRefreshChange).not.toHaveBeenCalled();
    });

    it("calls onRefresh when refresh button is clicked", () => {
      const onRefresh = vi.fn();
      render(<NewsFilterControls {...defaultProps} onRefresh={onRefresh} />, {
        wrapper: TestWrapper,
      });
      screen.getByTestId("news-refresh-btn").click();
      expect(onRefresh).toHaveBeenCalled();
    });

    it("calls onMarkAllRead when unread badge is clicked", () => {
      const onMarkAllRead = vi.fn();
      render(
        <NewsFilterControls {...defaultProps} unreadCount={5} onMarkAllRead={onMarkAllRead} />,
        { wrapper: TestWrapper },
      );
      screen.getByTestId("news-unread-badge").click();
      expect(onMarkAllRead).toHaveBeenCalled();
    });
  });

  describe("disabled states", () => {
    it("disables refresh button when loading", () => {
      render(<NewsFilterControls {...defaultProps} loading={true} />, { wrapper: TestWrapper });
      expect(screen.getByTestId("news-refresh-btn")).toBeDisabled();
    });

    it("disables refresh button when isRefreshing", () => {
      render(<NewsFilterControls {...defaultProps} isRefreshing={true} />, {
        wrapper: TestWrapper,
      });
      expect(screen.getByTestId("news-refresh-btn")).toBeDisabled();
    });
  });

  describe("edge cases", () => {
    it("renders with empty sourceData array", () => {
      const { container } = render(<NewsFilterControls {...defaultProps} sourceData={[]} />, {
        wrapper: TestWrapper,
      });
      expect(container).toBeInTheDocument();
    });

    it("renders with undefined sourceData", () => {
      const { container } = render(
        <NewsFilterControls {...defaultProps} sourceData={undefined as any} />,
        { wrapper: TestWrapper },
      );
      expect(container).toBeInTheDocument();
    });

    it("renders with empty string selectedSource", () => {
      render(<NewsFilterControls {...defaultProps} selectedSource="" />, { wrapper: TestWrapper });
      expect(screen.getByTestId("news-source-select")).toBeInTheDocument();
    });

    it("renders with undefined autoRefreshMs", () => {
      render(<NewsFilterControls {...defaultProps} autoRefreshMs={undefined as any} />, {
        wrapper: TestWrapper,
      });
      expect(screen.getByTestId("news-auto-refresh-select")).toBeInTheDocument();
    });

    it("renders with negative unreadCount", () => {
      render(<NewsFilterControls {...defaultProps} unreadCount={-1} />, { wrapper: TestWrapper });
      expect(screen.queryByTestId("news-unread-badge")).not.toBeInTheDocument();
    });

    it("handles rapid refresh clicks", async () => {
      const onRefresh = vi.fn();
      render(<NewsFilterControls {...defaultProps} onRefresh={onRefresh} />, {
        wrapper: TestWrapper,
      });

      const btn = screen.getByTestId("news-refresh-btn");
      btn.click();
      btn.click();
      btn.click();

      expect(onRefresh).toHaveBeenCalledTimes(3);
    });

    it("handles undefined onSourceChange gracefully", () => {
      const { container } = render(
        <NewsFilterControls {...defaultProps} onSourceChange={undefined as any} />,
        { wrapper: TestWrapper },
      );
      expect(container).toBeInTheDocument();
    });

    it("handles undefined onAutoRefreshChange gracefully", () => {
      const { container } = render(
        <NewsFilterControls {...defaultProps} onAutoRefreshChange={undefined as any} />,
        { wrapper: TestWrapper },
      );
      expect(container).toBeInTheDocument();
    });

    it("handles undefined onRefresh gracefully", () => {
      const { container } = render(
        <NewsFilterControls {...defaultProps} onRefresh={undefined as any} />,
        { wrapper: TestWrapper },
      );
      expect(container).toBeInTheDocument();
    });

    it("handles undefined onMarkAllRead gracefully", () => {
      const { container } = render(
        <NewsFilterControls {...defaultProps} unreadCount={5} onMarkAllRead={undefined as any} />,
        { wrapper: TestWrapper },
      );
      expect(container).toBeInTheDocument();
    });
  });
});

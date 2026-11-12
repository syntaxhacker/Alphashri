// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import type { JSX } from "solid-js";

let mockSelectedSymbols: string[] = [];

vi.mock("../../state", () => ({
  get selectedSymbols() {
    return mockSelectedSymbols;
  },
  clearSelectedSymbols: vi.fn(),
  setSelectedSymbols: vi.fn(),
  toggleSymbolSelection: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
  screenerOptions: [],
  profileMetaById: {},
}));

vi.mock("../../hooks/useStoreSubscription", () => ({
  useStoreSubscription: vi.fn(),
}));

vi.mock("./SelectionBar", () => ({
  SelectionBar: () => <div data-testid="selection-bar-mock" />,
}));

vi.mock("./ScreenerTable", () => ({
  ScreenerTable: (props: any) => (
    <div data-testid={props.testId || "screener-table"}>
      Table
      {props.columns.map((col: any) => (
        <span key={col.key} data-testid={`preview-sort-header-${col.key}`}>
          {col.label}
        </span>
      ))}
    </div>
  ),
}));

const mockCreateScreener = vi.fn();
const mockUpdateScreener = vi.fn();
const mockDeleteScreener = vi.fn();
vi.mock("../../api/screeners", () => ({
  createScreener: (...args: any[]) => mockCreateScreener(...args),
  updateScreener: (...args: any[]) => mockUpdateScreener(...args),
  deleteScreener: (...args: any[]) => mockDeleteScreener(...args),
}));

const mockLoadScreeners = vi.fn();
vi.mock("../../api/index", () => ({
  loadScreeners: (...args: any[]) => mockLoadScreeners(...args),
}));

let mockPreviewStocks: any[] = [];
let mockPreviewLoading = false;
const mockRefreshPreview = vi.fn();
vi.mock("../../hooks/useScreenerApi", () => ({
  useScreenerPreview: () => ({
    stocks: mockPreviewStocks,
    loading: mockPreviewLoading,
    refresh: mockRefreshPreview,
  }),
}));

import { ScreenerConfigView } from "./ScreenerConfigView";

const renderWithProvider = (ui: JSX.Element) =>
  render(() => <UIProvider>{ui}</UIProvider>);

const mockOptions = [
  {
    id: "trending",
    label: "Trending",
    description: "Top trending stocks",
    columns: ["symbol", "score", "rsi"],
    indicators: ["RSI"],
    filters: [{ key: "min_rsi", label: "Min RSI", type: "number", default: 30 }],
    default_sort: { column: "score", direction: "desc" },
  },
  {
    id: "new-highs",
    label: "New Highs",
    columns: ["symbol", "score"],
  },
];

describe("ScreenerConfigView", () => {
  const defaultProps = {
    screenerOptions: mockOptions,
    activeScreener: "trending",
    onScreenerChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectedSymbols = [];
    mockPreviewStocks = [];
    mockPreviewLoading = false;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders side panel with configs list", () => {
    renderWithProvider(<ScreenerConfigView {...defaultProps} />);
    expect(screen.getByTestId("screener-list-panel")).toBeInTheDocument();
    expect(screen.getByTestId("screener-configs-title")).toBeInTheDocument();
    expect(screen.getByText("CONFIGS")).toBeInTheDocument();
  });

  it("Clicking row calls onScreenerChange", async () => {
    const onChange = vi.fn();
    renderWithProvider(<ScreenerConfigView {...defaultProps} onScreenerChange={onChange} />);
    fireEvent.click(screen.getByTestId("screener-row-new-highs"));
    expect(onChange).toHaveBeenCalledWith("new-highs");
  });

  describe("create modal", () => {
    it("Create calls createScreener API on submit", async () => {
      mockCreateScreener.mockResolvedValueOnce({ id: 99 });
      renderWithProvider(<ScreenerConfigView {...defaultProps} />);
      fireEvent.click(screen.getByTestId("create-screener-btn"));
      await waitFor(() => {
        expect(screen.getByTestId("screener-name-input")).toBeInTheDocument();
      });
      fireEvent.input(screen.getByTestId("screener-name-input"), { target: { value: "My Screener" } });
      const confirmBtn = screen.getByTestId("confirm-create-btn");
      expect(confirmBtn).not.toBeDisabled();
      fireEvent.click(confirmBtn);
      await waitFor(() => {
        expect(mockCreateScreener).toHaveBeenCalled();
      });
      expect(mockLoadScreeners).toHaveBeenCalledWith(false);
    });
  });

  describe("edit modal", () => {
    it("Edit calls updateScreener API on submit", async () => {
      mockUpdateScreener.mockResolvedValueOnce({});
      renderWithProvider(<ScreenerConfigView {...defaultProps} />);
      fireEvent.click(screen.getByTestId("edit-screener-trending"));
      await waitFor(() => {
        expect(screen.getByTestId("confirm-create-btn")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("confirm-create-btn"));
      await waitFor(() => {
        expect(mockUpdateScreener).toHaveBeenCalled();
      });
      expect(mockLoadScreeners).toHaveBeenCalledWith(false);
    });
  });

  describe("delete modal", () => {
    it("Delete calls deleteScreener API on confirm", async () => {
      mockDeleteScreener.mockResolvedValueOnce({});
      renderWithProvider(<ScreenerConfigView {...defaultProps} />);
      fireEvent.click(screen.getByTestId("delete-screener-trending"));
      await waitFor(() => {
        expect(screen.getByText("Delete")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText("Delete"));
      await waitFor(() => {
        expect(mockDeleteScreener).toHaveBeenCalled();
      });
      expect(mockLoadScreeners).toHaveBeenCalledWith(false);
    });

    it("Deleting active screener navigates to trending", async () => {
      const onChange = vi.fn();
      renderWithProvider(
        <ScreenerConfigView {...defaultProps} onScreenerChange={onChange} />,
      );
      mockDeleteScreener.mockResolvedValueOnce({});
      fireEvent.click(screen.getByTestId("delete-screener-trending"));
      await waitFor(() => {
        expect(screen.getByText("Delete")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText("Delete"));
      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith("trending");
      });
    });
  });

  describe("cancel button", () => {
    it("Cancel button closes create modal", async () => {
      renderWithProvider(<ScreenerConfigView {...defaultProps} />);
      fireEvent.click(screen.getByTestId("create-screener-btn"));
      await waitFor(() => {
        expect(screen.getByTestId("screener-name-input")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("cancel-create-btn"));
      await waitFor(() => {
        expect(screen.queryByTestId("screener-name-input")).not.toBeInTheDocument();
      });
    });
  });

  describe("preview debounce", () => {
    it("Preview refreshes on screener change with debounce", async () => {
      vi.useFakeTimers();
      const onChange = vi.fn();
      const { rerender } = render(() => (
        <UIProvider>
          <ScreenerConfigView
            screenerOptions={defaultProps.screenerOptions}
            activeScreener="trending"
            onScreenerChange={onChange}
          />
        </UIProvider>
      ));

      expect(mockRefreshPreview).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);
      await vi.runOnlyPendingTimersAsync();
      expect(mockRefreshPreview).toHaveBeenCalledTimes(1);

      mockRefreshPreview.mockClear();

      rerender(() => (
        <UIProvider>
          <ScreenerConfigView
            screenerOptions={defaultProps.screenerOptions}
            activeScreener="new-highs"
            onScreenerChange={onChange}
          />
        </UIProvider>
      ));

      expect(mockRefreshPreview).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);
      await vi.runOnlyPendingTimersAsync();
      expect(mockRefreshPreview).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  describe("preview panel", () => {
    it("Preview shows loading state", () => {
      mockPreviewLoading = true;
      renderWithProvider(<ScreenerConfigView {...defaultProps} />);
      expect(screen.getByTestId("preview-loading")).toBeInTheDocument();
      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("Preview shows empty state when no stocks", () => {
      renderWithProvider(<ScreenerConfigView {...defaultProps} />);
      expect(screen.getByTestId("preview-empty")).toBeInTheDocument();
      expect(screen.getByText("No stocks")).toBeInTheDocument();
    });

    it("Preview shows data state when stocks exist", () => {
      mockPreviewStocks = [{ symbol: "RELIANCE", score: 85 }];
      renderWithProvider(<ScreenerConfigView {...defaultProps} />);
      expect(screen.queryByTestId("preview-empty")).not.toBeInTheDocument();
      expect(screen.queryByTestId("preview-loading")).not.toBeInTheDocument();
      expect(screen.getByTestId("preview-table")).toBeInTheDocument();
    });


  });
});

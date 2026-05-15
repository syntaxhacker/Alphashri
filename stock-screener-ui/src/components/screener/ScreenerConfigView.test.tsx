// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MantineProvider } from "@mantine/core";
import type { ReactElement } from "react";

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
  sortColumn: null,
  sortDirection: "desc",
  setSortColumn: vi.fn(),
  setSortDirection: vi.fn(),
}));

vi.mock("../../hooks/useStoreSubscription", () => ({
  useStoreSubscription: vi.fn(),
}));

vi.mock("./SelectionBar", () => ({
  SelectionBar: () => <div data-testid="selection-bar-mock" />,
}));

vi.mock("./ScreenerTable", () => ({
  ScreenerTable: (props: any) => (
    <div data-testid={props["data-testid"] || "screener-table"}>
      Table
      {props.columns.map((col: any) => (
        <button
          key={col.key}
          data-testid={`preview-sort-header-${col.key}`}
          onClick={() => props.onSortChange(col.key)}
        >
          {col.label}
        </button>
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

const renderWithProvider = (ui: ReactElement) =>
  render(<MantineProvider>{ui}</MantineProvider>);

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

  it("highlights active screener with blue background", () => {
    renderWithProvider(<ScreenerConfigView {...defaultProps} />);
    const activeRow = screen.getByTestId("screener-row-trending");
    expect(activeRow).toBeInTheDocument();
  });

  it("shows Active badge for current screener", () => {
    renderWithProvider(<ScreenerConfigView {...defaultProps} />);
    expect(screen.getByTestId("screener-active-badge")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders all screener options", () => {
    renderWithProvider(<ScreenerConfigView {...defaultProps} />);
    expect(screen.getByTestId("screener-row-trending")).toBeInTheDocument();
    expect(screen.getByTestId("screener-row-new-highs")).toBeInTheDocument();
  });

  it("renders create button", () => {
    renderWithProvider(<ScreenerConfigView {...defaultProps} />);
    expect(screen.getByTestId("create-screener-btn")).toBeInTheDocument();
  });

  it("renders edit and delete buttons for each screener", () => {
    renderWithProvider(<ScreenerConfigView {...defaultProps} />);
    expect(screen.getByTestId("edit-screener-trending")).toBeInTheDocument();
    expect(screen.getByTestId("delete-screener-trending")).toBeInTheDocument();
    expect(screen.getByTestId("edit-screener-new-highs")).toBeInTheDocument();
    expect(screen.getByTestId("delete-screener-new-highs")).toBeInTheDocument();
  });

  it("renders preview panel", () => {
    renderWithProvider(<ScreenerConfigView {...defaultProps} />);
    expect(screen.getByTestId("screener-preview-panel")).toBeInTheDocument();
    expect(screen.getByTestId("preview-header")).toBeInTheDocument();
  });

  it("preview shows preview count with stock count", () => {
    renderWithProvider(<ScreenerConfigView {...defaultProps} />);
    expect(screen.getByTestId("preview-count")).toHaveTextContent("PREVIEW (0)");
  });

  it("preview shows empty state when no stocks", () => {
    renderWithProvider(<ScreenerConfigView {...defaultProps} />);
    expect(screen.getByTestId("preview-empty")).toBeInTheDocument();
    expect(screen.getByText("No stocks")).toBeInTheDocument();
  });

  it("preview refresh button exists", () => {
    renderWithProvider(<ScreenerConfigView {...defaultProps} />);
    expect(screen.getByTestId("preview-refresh-btn")).toBeInTheDocument();
  });

  it("shows active screener name badge in filters bar", () => {
    renderWithProvider(<ScreenerConfigView {...defaultProps} />);
    expect(screen.getByTestId("screener-name-badge")).toHaveTextContent("Trending");
  });

  it("shows filter badges for active screener with filters", () => {
    renderWithProvider(<ScreenerConfigView {...defaultProps} />);
    expect(screen.getByTestId("screener-filters")).toBeInTheDocument();
  });

  it("Clicking row calls onScreenerChange", () => {
    const onChange = vi.fn();
    renderWithProvider(<ScreenerConfigView {...defaultProps} onScreenerChange={onChange} />);
    fireEvent.click(screen.getByTestId("screener-row-new-highs"));
    expect(onChange).toHaveBeenCalledWith("new-highs");
  });

  describe("create modal", () => {
    it("Create button opens modal with form", async () => {
      renderWithProvider(<ScreenerConfigView {...defaultProps} />);
      fireEvent.click(screen.getByTestId("create-screener-btn"));
      await waitFor(() => {
        expect(screen.getByTestId("screener-name-input")).toBeInTheDocument();
      });
      expect(screen.getByTestId("cancel-create-btn")).toBeInTheDocument();
      expect(screen.getByTestId("confirm-create-btn")).toBeInTheDocument();
    });

    it("Create form has indicator checkboxes", async () => {
      renderWithProvider(<ScreenerConfigView {...defaultProps} />);
      fireEvent.click(screen.getByTestId("create-screener-btn"));
      await waitFor(() => {
        expect(screen.getByRole("checkbox", { name: "RSI" })).toBeInTheDocument();
      });
      ["ADX", "Volume", "52W Gap %", "Stochastic", "ATR", "MACD", "Momentum"].forEach((ind) => {
        expect(screen.getByRole("checkbox", { name: ind })).toBeInTheDocument();
      });
    });

    it("Toggling indicator adds filter inputs", async () => {
      renderWithProvider(<ScreenerConfigView {...defaultProps} />);
      fireEvent.click(screen.getByTestId("create-screener-btn"));
      await waitFor(() => {
        expect(screen.getByRole("checkbox", { name: "RSI" })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("checkbox", { name: "Momentum" }));
      await waitFor(() => {
        expect(screen.getAllByText("Momentum").length).toBeGreaterThan(1);
      });
    });

    it("Filter inputs render for pre-selected indicators", async () => {
      renderWithProvider(<ScreenerConfigView {...defaultProps} />);
      fireEvent.click(screen.getByTestId("create-screener-btn"));
      await waitFor(() => {
        expect(screen.getByRole("checkbox", { name: "RSI" })).toBeInTheDocument();
      });
      expect(screen.getByLabelText("Min RSI")).toBeInTheDocument();
    });

    it("Default sort column and direction selects are present", async () => {
      renderWithProvider(<ScreenerConfigView {...defaultProps} />);
      fireEvent.click(screen.getByTestId("create-screener-btn"));
      await waitFor(() => {
        expect(screen.getByRole("checkbox", { name: "RSI" })).toBeInTheDocument();
      });
      expect(screen.getByTestId("cancel-create-btn")).toBeInTheDocument();
    });

    it("Create calls createScreener API on submit", async () => {
      mockCreateScreener.mockResolvedValueOnce({ id: 99 });
      renderWithProvider(<ScreenerConfigView {...defaultProps} />);
      fireEvent.click(screen.getByTestId("create-screener-btn"));
      await waitFor(() => {
        expect(screen.getByTestId("screener-name-input")).toBeInTheDocument();
      });
      fireEvent.change(screen.getByTestId("screener-name-input"), { target: { value: "My Screener" } });
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
    it("Edit button opens modal with prefilled form", async () => {
      renderWithProvider(<ScreenerConfigView {...defaultProps} />);
      fireEvent.click(screen.getByTestId("edit-screener-trending"));
      await waitFor(() => {
        expect(screen.getByTestId("screener-name-input")).toBeInTheDocument();
      });
      expect(screen.getByTestId("confirm-create-btn")).toBeInTheDocument();
    });

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
    it("Delete button opens delete confirmation modal", async () => {
      renderWithProvider(<ScreenerConfigView {...defaultProps} />);
      fireEvent.click(screen.getByTestId("delete-screener-trending"));
      await waitFor(() => {
        expect(screen.getByText((content) => content.includes("Are you sure you want to delete"))).toBeInTheDocument();
      });
      expect(screen.getByText("Delete")).toBeInTheDocument();
    });

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
      const { rerender } = render(
        <MantineProvider>
          <ScreenerConfigView
            screenerOptions={defaultProps.screenerOptions}
            activeScreener="trending"
            onScreenerChange={onChange}
          />
        </MantineProvider>,
      );

      expect(mockRefreshPreview).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);
      await vi.runOnlyPendingTimersAsync();
      expect(mockRefreshPreview).toHaveBeenCalledTimes(1);

      mockRefreshPreview.mockClear();

      rerender(
        <MantineProvider>
          <ScreenerConfigView
            screenerOptions={defaultProps.screenerOptions}
            activeScreener="new-highs"
            onScreenerChange={onChange}
          />
        </MantineProvider>,
      );

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

    it("Preview has sortable table", () => {
      mockPreviewStocks = [{ symbol: "RELIANCE", score: 85 }];
      renderWithProvider(<ScreenerConfigView {...defaultProps} />);
      const symbolSort = screen.getByTestId("preview-sort-header-symbol");
      expect(symbolSort).toBeInTheDocument();
      fireEvent.click(symbolSort);
    });
  });
});

// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { ErrorBoundary, type JSX } from "solid-js";

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
        <span data-testid={`preview-sort-header-${col.key}`}>
          {col.label}
        </span>
      ))}
      <button
        type="button"
        data-testid="preview-symbol-click"
        onClick={() => props.onSymbolClick("RELIANCE")}
      >
        open symbol
      </button>
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

const mockFetchWithAuth = vi.fn();
const mockBuildScreenerPreviewUrl = vi.fn(
  (opts: { screener?: string; filters?: unknown }) =>
    `/api/screener/preview?screener=${opts?.screener ?? ""}`,
);
vi.mock("@/api/screenerQuery", () => ({
  // Reflect the argument: a constant mock let a preview fetch the wrong
  // screener and still pass. Captured so filter-shape tests can assert on the
  // exact `{key, default}` entries handed to the URL builder.
  buildScreenerPreviewUrl: (...args: any[]) => (mockBuildScreenerPreviewUrl as any)(...args),
  approachingStocksOf: (json: any) => json?.approaching ?? [],
}));
vi.mock("@/state/auth", () => ({
  fetchWithAuth: (...args: any[]) => mockFetchWithAuth(...args),
}));

import { ScreenerConfigView } from "./ScreenerConfigView";

const renderWithProvider = (ui: JSX.Element) =>
  render(() => <UIProvider>{ui}</UIProvider>);

import type { ScreenerOption } from "../../types";

const mockOptions: ScreenerOption[] = [
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
    // Default: preview fetch never resolves so the loading skeleton persists.
    mockFetchWithAuth.mockReset();
    mockFetchWithAuth.mockReturnValue(new Promise(() => {}));
    mockBuildScreenerPreviewUrl.mockClear();
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

    it("opens dict-shaped select filters as selects, not number inputs", async () => {
      const options = [
        {
          id: "buyer_interest_enhanced",
          label: "Buyer Interest+",
          columns: ["symbol", "score"],
          filters: { direction: "bullish" },
        },
      ] as unknown as ScreenerOption[];
      renderWithProvider(
        <ScreenerConfigView
          screenerOptions={options}
          activeScreener="buyer_interest_enhanced"
          onScreenerChange={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId("edit-screener-buyer_interest_enhanced"));
      await waitFor(() => {
        expect(screen.getByTestId("confirm-create-btn")).toBeInTheDocument();
      });

      const direction = screen.getByDisplayValue("bullish") as HTMLSelectElement;
      expect(direction.tagName).toBe("SELECT");
      expect(Array.from(direction.options).map((option) => option.value)).toEqual([
        "both",
        "bullish",
        "bearish",
      ]);
      expect(document.querySelector('input[type="number"][aria-label="Direction"]')).toBeNull();
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
    const fetchedScreener = () => {
      const urls = mockFetchWithAuth.mock.calls.map((c) => String(c[0]));
      const last = urls[urls.length - 1] ?? "";
      return new URL(last, "http://x").searchParams.get("screener");
    };
    const uniqueFetches = () => new Set(mockFetchWithAuth.mock.calls.map((c) => String(c[0]))).size;
    it("Preview fetches on screener change with debounce", async () => {
      vi.useFakeTimers();
      try {
        mockFetchWithAuth.mockReset();
        mockFetchWithAuth.mockResolvedValue({
          ok: true,
          json: async () => ({ approaching: [], touched: [] }),
        });
        const onChange = vi.fn();
        const { createSignal } = await import("solid-js");
        const [screener, setScreener] = createSignal("trending");
        render(() => (
          <UIProvider>
            <ScreenerConfigView
              screenerOptions={defaultProps.screenerOptions}
              activeScreener={screener()}
              onScreenerChange={onChange}
            />
          </UIProvider>
        ));

        expect(mockFetchWithAuth).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(500);
        // The URL is the contract: a call count would still pass if the preview
        // fetched the wrong screener, and it races against lingering effects.
        expect(fetchedScreener()).toBe("trending");

        setScreener("new-highs");
        await vi.advanceTimersByTimeAsync(500);

        // A debounce means the *last* selection wins, once.
        expect(fetchedScreener()).toBe("new-highs");
        expect(uniqueFetches()).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("preview panel", () => {
    it("Preview shows loading state", () => {
      renderWithProvider(<ScreenerConfigView {...defaultProps} />);
      expect(screen.getByTestId("preview-loading")).toBeInTheDocument();
      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("Preview shows empty state when no stocks", async () => {
      mockFetchWithAuth.mockReset();
      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        json: async () => ({ approaching: [], touched: [] }),
      });
      renderWithProvider(<ScreenerConfigView {...defaultProps} />);
      await waitFor(() => expect(screen.getByTestId("preview-empty")).toBeInTheDocument());
      expect(screen.getByText("No stocks")).toBeInTheDocument();
    });

    it("Preview shows data state when stocks exist", async () => {
      mockFetchWithAuth.mockReset();
      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        json: async () => ({ approaching: [{ symbol: "RELIANCE", score: 85 }], touched: [] }),
      });
      renderWithProvider(<ScreenerConfigView {...defaultProps} />);
      await waitFor(() => expect(screen.getByTestId("preview-table")).toBeInTheDocument());
      expect(screen.queryByTestId("preview-empty")).not.toBeInTheDocument();
      expect(screen.queryByTestId("preview-loading")).not.toBeInTheDocument();
    });

    it("labels filter badges with the saved filter label, not its backend key", async () => {
      mockFetchWithAuth.mockReset();
      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        json: async () => ({ approaching: [], touched: [] }),
      });
      renderWithProvider(<ScreenerConfigView {...defaultProps} />);
      await waitFor(() => expect(screen.getByTestId("preview-empty")).toBeInTheDocument());

      expect(screen.getByTestId("screener-filters")).toHaveTextContent("Min RSI: 30");
      expect(screen.getByTestId("screener-filters")).not.toHaveTextContent("min rsi: 30");
    });

    it("wires preview rows to the parent symbol handler and drops the no-op compare bar", async () => {
      const onSymbolClick = vi.fn();
      mockFetchWithAuth.mockReset();
      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        json: async () => ({ approaching: [{ symbol: "RELIANCE", score: 85 }], touched: [] }),
      });
      renderWithProvider(
        <ScreenerConfigView {...defaultProps} onSymbolClick={onSymbolClick} />,
      );
      await waitFor(() => expect(screen.getByTestId("preview-table")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("preview-symbol-click"));
      expect(onSymbolClick).toHaveBeenCalledWith("RELIANCE");
      expect(screen.queryByTestId("selection-bar-mock")).not.toBeInTheDocument();
    });

  });

  // `/api/screeners` returns `filters` as a dict (`{key: default}`), while the
  // TS type says `ProfileFilter[]`. The preview must survive either shape.
  describe("filter shape handling", () => {
    const renderFilterShape = async (filters: unknown, withBoundary = false) => {
      const options = [
        { id: "shape-test", label: "Shape Test", columns: ["symbol", "score"], filters },
      ] as unknown as ScreenerOption[];
      vi.useFakeTimers();
      try {
        render(() => (
          <UIProvider>
            {withBoundary ? (
              <ErrorBoundary fallback={<div data-testid="shape-error-boundary">crashed</div>}>
                <ScreenerConfigView
                  screenerOptions={options}
                  activeScreener="shape-test"
                  onScreenerChange={vi.fn()}
                />
              </ErrorBoundary>
            ) : (
              <ScreenerConfigView
                screenerOptions={options}
                activeScreener="shape-test"
                onScreenerChange={vi.fn()}
              />
            )}
          </UIProvider>
        ));
        await vi.advanceTimersByTimeAsync(500);
      } finally {
        vi.useRealTimers();
      }
    };

    const lastPreviewFilters = (): unknown => {
      const calls = mockBuildScreenerPreviewUrl.mock.calls;
      return calls.length ? calls[calls.length - 1][0]?.filters : undefined;
    };

    it("(a) array of {key, default} still produces the same entries (regression)", async () => {
      await renderFilterShape([
        { key: "min_rsi", default: 30 },
        { key: "min_adx", default: 15 },
      ]);
      expect(lastPreviewFilters()).toEqual([
        { key: "min_rsi", default: 30 },
        { key: "min_adx", default: 15 },
      ]);
    });

    it("(b) dict of key -> value produces {key, default} entries", async () => {
      await renderFilterShape({ min_surge_pct: 5, min_volume_m: 0.1 });
      expect(lastPreviewFilters()).toEqual([
        { key: "min_surge_pct", default: 5 },
        { key: "min_volume_m", default: 0.1 },
      ]);
    });

    it("(c) dict array-pair value produces <key>_min / <key>_max entries", async () => {
      await renderFilterShape({ rsi_range: [30, 70], min_volume_m: 1 });
      expect(lastPreviewFilters()).toEqual([
        { key: "rsi_range_min", default: 30 },
        { key: "rsi_range_max", default: 70 },
        { key: "min_volume_m", default: 1 },
      ]);
    });

    it("(c2) dict null value is skipped (no key= with empty default)", async () => {
      await renderFilterShape({ rsi_range: null, min_volume_m: 1 });
      expect(lastPreviewFilters()).toEqual([{ key: "min_volume_m", default: 1 }]);
    });

    it("(c3) dict filters render human labels and never leak raw keys or nulls", async () => {
      await renderFilterShape({
        max_52w_gap: 5,
        min_volume_m: 0,
        min_turnover_cr: 0.5,
        rsi_range: null,
      });
      expect(screen.getByText("52W gap: 5")).toBeInTheDocument();
      expect(screen.getByText("Volume (M): 0")).toBeInTheDocument();
      expect(screen.getByText("Turnover (Cr): 0.5")).toBeInTheDocument();
      expect(screen.queryByText(/max 52w gap/i)).toBeNull();
      expect(screen.queryByText(/rsi range: null/i)).toBeNull();
      expect(screen.queryByText(/null/i)).toBeNull();
    });

    it("(d) null / undefined / scalar filters yield [] and never throw", async () => {
      for (const bad of [null, undefined, 42, "oops", true]) {
        cleanup();
        mockBuildScreenerPreviewUrl.mockClear();
        await renderFilterShape(bad);
        expect(lastPreviewFilters()).toEqual([]);
      }
    });

    it("(e) every shape renders without hitting the error boundary", async () => {
      const shapes: unknown[] = [
        [{ key: "min_rsi", default: 30 }],
        { min_surge_pct: 5 },
        { rsi_range: [30, 70] },
        null,
        undefined,
        42,
      ];
      for (const filters of shapes) {
        cleanup();
        mockBuildScreenerPreviewUrl.mockClear();
        await renderFilterShape(filters, true);
        expect(screen.getByTestId("screener-list-panel")).toBeInTheDocument();
        expect(screen.queryByTestId("shape-error-boundary")).not.toBeInTheDocument();
      }
    });
  });
});

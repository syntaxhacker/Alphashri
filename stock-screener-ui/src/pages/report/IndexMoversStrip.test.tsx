import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSignal } from "solid-js";
import { render, screen, waitFor, fireEvent } from "@solidjs/testing-library";
import { AvailableBands, IndexMoversStrip, UnavailableBandsStrip } from "./IndexMoversStrip";
import { fetchIndexMovers, IndexMoversResponse } from "@/api/indexMovers";
import { SymbolDockContext, type SymbolDockApi } from "@/components/common/symbolDockContext";

const spies = vi.hoisted(() => ({ handleSymbolChange: vi.fn() }));

vi.mock("@/api/indexMovers", () => ({
  fetchIndexMovers: vi.fn(),
}));

// The movers strip must never switch the report underlying, even if a future
// edit reintroduces the store hook.
vi.mock("./ReportContext", () => ({
  useNiftyReport: () => ({ selection: { handleSymbolChange: spies.handleSymbolChange } }),
}));

const mockFetchIndexMovers = vi.mocked(fetchIndexMovers);

const createMockResponse = (overrides: Partial<IndexMoversResponse> = {}): IndexMoversResponse => ({
  index: "NIFTY",
  as_of: new Date().toISOString(),
  stale: false,
  source: "NIFTY50_WEIGHTS (Tickertape 2026-10-15)",
  gainers: [
    { symbol: "HDFCBANK", ltp: 1750.0, change_pct: 1.92, contribution_pct: 0.206, volume: 1234567 },
    { symbol: "TITAN", ltp: 3450.0, change_pct: 1.45, contribution_pct: 0.023, volume: 876543 },
    { symbol: "BAJFINANCE", ltp: 7200.0, change_pct: 1.12, contribution_pct: 0.027, volume: 543210 },
  ],
  losers: [
    { symbol: "TCS", ltp: 3450.0, change_pct: -2.52, contribution_pct: -0.058, volume: 987654 },
    { symbol: "INFY", ltp: 1450.0, change_pct: -1.73, contribution_pct: -0.063, volume: 765432 },
    { symbol: "HCLTECH", ltp: 1250.0, change_pct: -1.28, contribution_pct: -0.017, volume: 432109 },
  ],
  live_only: false,
  ...overrides,
});

describe("IndexMoversStrip", () => {
  const onExpand = vi.fn();

  const dockApi = (open: (symbol: string) => void): SymbolDockApi => ({
    open,
    preview: vi.fn(),
    endPreview: vi.fn(),
    close: vi.fn(),
    pinned: false,
    setOutlet: vi.fn(),
  });

  beforeEach(() => {
    mockFetchIndexMovers.mockReset();
    spies.handleSymbolChange.mockClear();
    onExpand.mockClear();
  });

  it("renders loading state initially", async () => {
    let _resolve: (v: IndexMoversResponse) => void;
    const promise = new Promise<IndexMoversResponse>((r) => { _resolve = r; });
    mockFetchIndexMovers.mockReturnValue(promise);

    render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} />);

    expect(screen.getByTestId("movers-strip")).toBeInTheDocument();
    expect(screen.getByText("MOVERS")).toBeInTheDocument();
    expect(screen.getByText("loading…")).toBeInTheDocument();
  });

  it("renders gainers and losers when data loads", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());

    render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} />);

    await waitFor(() => expect(screen.getByText("HDFCBANK")).toBeInTheDocument(), { timeout: 10000 });
    await waitFor(() => expect(screen.getByText("TCS")).toBeInTheDocument(), { timeout: 10000 });

    expect(mockFetchIndexMovers).toHaveBeenCalledWith("NIFTY", 5, expect.anything());
    expect(screen.getByText("+1.92%")).toBeInTheDocument();
    expect(screen.getByText("-2.52%")).toBeInTheDocument();
  });

  it("shows EXPAND button", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());

    render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} />);

    await waitFor(() => expect(screen.getByTestId("movers-expand")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.getByTestId("movers-expand")).toHaveTextContent("EXPAND");
  });

  it("calls onExpand when EXPAND clicked", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());

    render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} />);

    await waitFor(() => expect(screen.getByTestId("movers-expand")).toBeInTheDocument(), { timeout: 10000 });
    fireEvent.click(screen.getByTestId("movers-expand"));

    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("shows stale badge when data.stale is true", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse({ stale: true }));

    render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} />);

    await waitFor(() => expect(screen.getByText("STALE")).toBeInTheDocument(), { timeout: 10000 });
  });

  it("collapses the strip in EOD/replay instead of faking a live-only row", () => {
    render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} liveOnly />);

    // Replay has no movers feed; the page's replay banner names it once for all
    // live-only bands, so the strip renders nothing rather than an empty 24px row.
    expect(screen.queryByTestId("movers-strip")).toBeNull();
    expect(screen.queryByText("MOVERS")).toBeNull();
    expect(mockFetchIndexMovers).not.toHaveBeenCalled();
  });

  it("shows and hides the strip as the liveOnly prop signal flips", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());
    const [liveOnlySig, setLiveOnlySig] = createSignal(false);
    render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} liveOnly={liveOnlySig()} />);

    await waitFor(() => expect(screen.getByTestId("movers-strip")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.getByText(/MOVERS · NIFTY 50/)).toBeInTheDocument();

    setLiveOnlySig(true);

    expect(screen.queryByTestId("movers-strip")).toBeNull();
  });

  it("shows error state when fetch fails", async () => {
    mockFetchIndexMovers.mockRejectedValue(new Error("Network error"));

    render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} />);

    await waitFor(() => expect(screen.getByText("unavailable")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("shows MOVERS_UNAVAILABLE error correctly", async () => {
    mockFetchIndexMovers.mockRejectedValue(new Error("MOVERS_UNAVAILABLE"));

    render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} />);

    await waitFor(() => expect(screen.getByText("unavailable")).toBeInTheDocument(), { timeout: 10000 });
  });

  it("renders SENSEX 30 label correctly", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse({ index: "SENSEX" }));

    render(() =>
      <IndexMoversStrip index="SENSEX" onExpand={onExpand} />);

    await waitFor(() => expect(screen.getByTestId("movers-strip")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.getByTestId("movers-strip")).toHaveTextContent(/SENSEX 30/);
  });

  it("keeps 12px labels and 13px whole values, wrapping on a phone", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());
    render(() => <IndexMoversStrip index="NIFTY" onExpand={onExpand} />);

    await waitFor(() => expect(screen.getByText("HDFCBANK")).toBeInTheDocument(), { timeout: 10000 });
    const strip = screen.getByTestId("movers-strip");
    expect(strip.getAttribute("data-report-spacing")).toBe("8");
    expect(strip.className).toContain("max-[700px]:flex-wrap");
    expect(strip.className).not.toContain("overflow-hidden");
    expect(strip.innerHTML).not.toContain("text-ellipsis");
    expect(strip.innerHTML).not.toContain("truncate");

    const label = strip.querySelector('[data-report-text="label"]') as HTMLElement;
    expect(label.className).toContain("text-ui-micro");
    const values = strip.querySelectorAll('[data-report-text="value"]');
    expect(values.length).toBe(12);
    for (const value of values) expect((value as HTMLElement).style.fontSize).toBe("13px");
    expect(strip).toHaveTextContent("HDFCBANK");
    expect(strip).toHaveTextContent("+1.92%");
    expect(strip).toHaveTextContent("-2.52%");
  });

  it("reserves the EXPAND lane and masks mover text in the 460px desk window", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());
    render(() => <IndexMoversStrip index="NIFTY" onExpand={onExpand} />);

    await waitFor(() => expect(screen.getByText("TCS")).toBeInTheDocument(), { timeout: 10000 });

    const strip = screen.getByTestId("movers-strip");
    const row = strip.querySelector('[data-testid="movers-row"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    // The 1600px monitor shows a ~460px desk panel while the viewport stays wide,
    // so the phone wrap media query never fires. The lane must clip its overflow
    // instead of painting the trailing loser under the EXPAND control.
    expect(row!.className).toContain("min-w-0");
    expect(row!.className).toContain("flex-auto");
    expect(row!.className).toContain("overflow-hidden");
    expect(row!.style.textOverflow).toBe("ellipsis");
    // Full value survives in the DOM and the hover tooltip even when masked.
    expect(strip.textContent).toContain("TCS");
    expect(strip.textContent).toContain("-2.52%");
    expect(row!.getAttribute("title")).toContain("TCS");
    expect(row!.getAttribute("title")).toContain("-2.52%");
    // The button keeps its own non-shrinking lane, so its width is reserved.
    const actions = screen.getByTestId("movers-actions");
    expect(actions.className).toContain("shrink-0");
    expect(actions.querySelector('[data-testid="movers-expand"]')).not.toBeNull();
  });

  describe("one status strip for unavailable bands", () => {
    const slot = (label: string, available: boolean) => ({
      label,
      available: () => available,
      band: () => <div data-testid={`band-${label.toLowerCase()}`} />,
    });

    it("all-empty collapses to a single 30px row naming every surface", () => {
      render(() => (
        <AvailableBands
          bands={[slot("WINDOWS", false), slot("MOVERS", false), slot("WALLS", false)]}
          onRetry={() => {}}
        />
      ));

      const strips = screen.getAllByTestId("report-unavailable-strip");
      expect(strips).toHaveLength(1);
      expect(strips[0]).toHaveAttribute("data-surfaces", "WINDOWS|MOVERS|WALLS");
      expect(strips[0]).toHaveTextContent(/WINDOWS · MOVERS · WALLS/);
      expect(strips[0].className).toContain("h-[30px]");
      expect(strips[0].className).toContain("min-h-[30px]");
      expect(strips[0].className).toContain("whitespace-nowrap");
      expect(screen.getByTestId("report-unavailable-retry")).toBeInTheDocument();
      for (const label of ["windows", "movers", "walls"]) {
        expect(screen.queryByTestId(`band-${label}`)).toBeNull();
      }
    });

    it("partial available renders only the real band and names the rest once", () => {
      render(() => (
        <AvailableBands
          bands={[slot("WINDOWS", true), slot("MOVERS", false), slot("WALLS", false)]}
          onRetry={() => {}}
        />
      ));

      expect(screen.getByTestId("band-windows")).toBeInTheDocument();
      expect(screen.queryByTestId("band-movers")).toBeNull();
      expect(screen.queryByTestId("band-walls")).toBeNull();
      const strip = screen.getByTestId("report-unavailable-strip");
      expect(strip).toHaveAttribute("data-surfaces", "MOVERS|WALLS");
      expect(screen.getAllByTestId("report-unavailable-strip")).toHaveLength(1);
      expect(screen.getAllByTestId("report-unavailable-retry")).toHaveLength(1);
    });

    it("an unavailable MOVERS row names the other surfaces and keeps one Retry", async () => {
      mockFetchIndexMovers.mockRejectedValue(new Error("MOVERS_UNAVAILABLE"));

      render(() => (
        <IndexMoversStrip
          index="NIFTY"
          onExpand={onExpand}
          unavailableSurfaces={["WINDOWS", "WALLS"]}
        />
      ));

      await waitFor(() => expect(screen.getByText("unavailable")).toBeInTheDocument());
      const strip = screen.getByTestId("movers-strip");
      expect(screen.getAllByTestId("movers-strip")).toHaveLength(1);
      expect(strip).toHaveAttribute("data-surfaces", "WINDOWS|WALLS");
      expect(strip).toHaveTextContent(/WINDOWS · WALLS/);
      expect(strip.className).toContain("h-[30px]");
      expect(strip.className).not.toContain("flex-wrap");
      expect(screen.getByTestId("movers-retry")).toBeInTheDocument();
    });

    it("keeps one disclosure control on the status row", () => {
      const [open, setOpen] = createSignal(false);
      render(() => (
        <UnavailableBandsStrip
          surfaces={["WINDOWS", "MOVERS", "WALLS"]}
          open={open()}
          onToggle={() => setOpen((v) => !v)}
        />
      ));

      const toggle = screen.getByRole("button", { name: /details/i });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(screen.getAllByTestId("report-unavailable-strip")).toHaveLength(1);
    });
  });

  describe("polling behavior", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("polls every 30s in live mode", async () => {
      mockFetchIndexMovers.mockResolvedValue(createMockResponse());

      render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} />);

      await vi.advanceTimersByTimeAsync(0);
      expect(mockFetchIndexMovers).toHaveBeenCalledTimes(1);
      expect(screen.getByText("HDFCBANK")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(30_000);
      expect(mockFetchIndexMovers).toHaveBeenCalledTimes(2);
    }, 10000);

    it("does not poll when liveOnly is true", async () => {
      mockFetchIndexMovers.mockResolvedValue(createMockResponse());

      render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} liveOnly />);

      expect(mockFetchIndexMovers).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30_000);
      expect(mockFetchIndexMovers).not.toHaveBeenCalled();
    });

    it("cleans up on unmount", async () => {
      mockFetchIndexMovers.mockResolvedValue(createMockResponse());

      const { unmount } = render(() =>
      <IndexMoversStrip index="NIFTY" onExpand={onExpand} />);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockFetchIndexMovers).toHaveBeenCalledTimes(1);

      unmount();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mockFetchIndexMovers).toHaveBeenCalledTimes(1);
    });
  });

  describe("movers are real activation targets", () => {
    it("never imports the report underlying switch", () => {
      const source = readFileSync(
        resolve(process.cwd(), "src/pages/report/IndexMoversStrip.tsx"),
        "utf8",
      );
      expect(source).not.toContain("handleSymbolChange");
      expect(source).not.toContain("useNiftyReport");
    });

    it("the index label opens the canonical index in the app-wide dock", async () => {
      mockFetchIndexMovers.mockResolvedValue(createMockResponse());
      const open = vi.fn();

      render(() => (
        <SymbolDockContext.Provider value={dockApi(open)}>
          <IndexMoversStrip index="NIFTY" onExpand={onExpand} />
        </SymbolDockContext.Provider>
      ));
      await waitFor(() => expect(screen.getByTestId("movers-index")).toBeInTheDocument());

      const label = screen.getByTestId("movers-index");
      expect(label.tagName).toBe("BUTTON");
      // axe label-content-name-mismatch: visible text must be the accessible name.
      expect(label).not.toHaveAttribute("aria-label");
      expect(label).toHaveAccessibleName("MOVERS · NIFTY 50");
      expect(label.className).toContain("focus-visible:outline-2");
      fireEvent.click(label);
      fireEvent.keyDown(label, { key: "Enter" });
      fireEvent.keyDown(label, { key: " " });
      expect(open).toHaveBeenCalledTimes(3);
      expect(open).toHaveBeenCalledWith("NIFTY");
      expect(spies.handleSymbolChange).not.toHaveBeenCalled();
    });

    it("SENSEX 30 opens SENSEX in the dock, not the report underlying", async () => {
      mockFetchIndexMovers.mockResolvedValue(createMockResponse({ index: "SENSEX" }));
      const open = vi.fn();

      render(() => (
        <SymbolDockContext.Provider value={dockApi(open)}>
          <IndexMoversStrip index="SENSEX" onExpand={onExpand} />
        </SymbolDockContext.Provider>
      ));
      await waitFor(() => expect(screen.getByTestId("movers-index")).toBeInTheDocument());

      expect(screen.getByTestId("movers-index")).toHaveAccessibleName("MOVERS · SENSEX 30");
      fireEvent.click(screen.getByTestId("movers-index"));
      expect(open).toHaveBeenCalledWith("SENSEX");
      expect(spies.handleSymbolChange).not.toHaveBeenCalled();
    });

    it("a constituent symbol is a focusable button that opens the chart dock", async () => {
      mockFetchIndexMovers.mockResolvedValue(createMockResponse());
      const onOpenSymbol = vi.fn();

      render(() => (
        <IndexMoversStrip
          index="NIFTY"
          onExpand={onExpand}
          onOpenSymbol={onOpenSymbol}
        />
      ));
      await waitFor(() => expect(screen.getByTestId("movers-symbol-HDFCBANK")).toBeInTheDocument());

      const symbol = screen.getByTestId("movers-symbol-HDFCBANK");
      expect(symbol.tagName).toBe("BUTTON");
      expect(symbol).toHaveAccessibleName("Open HDFCBANK chart");
      // Visible symbol is contained in the aria-label, so axe's name check passes.
      expect(symbol).toHaveAttribute("aria-label", expect.stringContaining("HDFCBANK"));
      expect(symbol.className).toContain("focus-visible:outline-2");
      fireEvent.click(symbol);
      fireEvent.keyDown(symbol, { key: "Enter" });
      expect(onOpenSymbol).toHaveBeenCalledWith("HDFCBANK");
      expect(onOpenSymbol).toHaveBeenCalledTimes(2);
    });

    it("keeps the 12px label / 13px value rhythm after making targets focusable", async () => {
      mockFetchIndexMovers.mockResolvedValue(createMockResponse());
      render(() => <IndexMoversStrip index="NIFTY" onExpand={onExpand} onOpenSymbol={vi.fn()} />);
      await waitFor(() => expect(screen.getByText("HDFCBANK")).toBeInTheDocument());

      const strip = screen.getByTestId("movers-strip");
      const label = strip.querySelector('[data-report-text="label"]') as HTMLElement;
      expect(label.className).toContain("text-ui-micro");
      const values = strip.querySelectorAll('[data-report-text="value"]');
      expect(values).toHaveLength(12);
      for (const value of values) expect((value as HTMLElement).style.fontSize).toBe("13px");
    });
  });
});
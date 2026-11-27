// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { SectorTable, SECTOR_TABLE_MIN_WIDTH } from "./SectorTable";
import { SymbolDockContext } from "../common/symbolDockContext";
import type { SectorItem } from "../../types/sector";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockSectors: SectorItem[] = [
  {
    sector: "IT",
    avg_change: 2.5,
    stock_count: 50,
    advances: 30,
    declines: 20,
    avg_rsi: 55,
    avg_adx: 26,
    top_movers: "TCS, INFY",
  },
  {
    sector: "Banking",
    avg_change: -1.0,
    stock_count: 40,
    advances: 15,
    declines: 25,
    avg_rsi: 45,
    avg_adx: 12,
    top_movers: "HDFC",
  },
];

describe("SectorTable rendering", () => {
  it("shows empty state when sectors array is empty", () => {
    render(() => <SectorTable sectors={[]} />);
    expect(screen.getByText("No sector data available")).toBeInTheDocument();
  });

  it("renders each sector row with sector name", () => {
    render(() => <SectorTable sectors={mockSectors} />);
    expect(screen.getByText("IT")).toBeInTheDocument();
    expect(screen.getByText("Banking")).toBeInTheDocument();
  });

  it("displays change value with +/- prefix", () => {
    render(() => <SectorTable sectors={mockSectors} />);
    expect(screen.getByText("+2.50%")).toBeInTheDocument();
    expect(screen.getByText("-1.00%")).toBeInTheDocument();
  });

  it("color-codes change value green for positive, red for negative", () => {
    render(() => <SectorTable sectors={mockSectors} />);
    const positiveChange = screen.getByText("+2.50%");
    const negativeChange = screen.getByText("-1.00%");
    expect(positiveChange).toBeInTheDocument();
    expect(negativeChange).toBeInTheDocument();
  });

  it("shows A/D Ratio as advances:declines text", () => {
    render(() => <SectorTable sectors={mockSectors} />);
    expect(screen.getByText("30 : 20")).toBeInTheDocument();
    expect(screen.getByText("15 : 25")).toBeInTheDocument();
  });

  it("shows strength badge label based on ADX", () => {
    render(() => <SectorTable sectors={mockSectors} />);
    expect(screen.getByText("Strong")).toBeInTheDocument();
    expect(screen.getByText("Weak")).toBeInTheDocument();
  });

  it("shows Strong badge in green for ADX > 25", () => {
    render(() => <SectorTable sectors={mockSectors} />);
    expect(screen.getByText("Strong")).toBeInTheDocument();
  });

  it("shows Weak badge in red for ADX < 15", () => {
    render(() => <SectorTable sectors={mockSectors} />);
    expect(screen.getByText("Weak")).toBeInTheDocument();
  });

  it("shows Neutral badge for ADX between 15 and 25", () => {
    const neutralSectors = [
      { ...mockSectors[0], avg_adx: 20, avg_change: 0.5 },
    ];
    render(() => <SectorTable sectors={neutralSectors} />);
    expect(screen.getByText("Neutral")).toBeInTheDocument();
  });

  it("normalizes a backend-supplied -0.0% top mover", () => {
    render(() => (
      <SectorTable
        sectors={[{ ...mockSectors[0], top_movers: "TCS(-0.0%) INFY(+1.2%)" }]}
      />
    ));
    expect(screen.getByTestId("sector-top-mover-TCS")).toBeInTheDocument();
    expect(screen.queryByText("(-0.0%)")).not.toBeInTheDocument();
    expect(screen.getByText("(0.0%)")).toBeInTheDocument();
    expect(screen.getByText("(+1.2%)")).toBeInTheDocument();
  });

  it("renders each top mover as a focusable symbol button", () => {
    render(() => <SectorTable sectors={mockSectors} />);
    expect(screen.getByTestId("sector-top-mover-TCS").tagName).toBe("BUTTON");
    expect(screen.getByTestId("sector-top-mover-INFY").tagName).toBe("BUTTON");
    expect(screen.getByTestId("sector-top-mover-HDFC").tagName).toBe("BUTTON");
  });

  it("renders table headers", () => {
    render(() => <SectorTable sectors={mockSectors} />);
    expect(screen.getByText("Sector")).toBeInTheDocument();
    expect(screen.getByText("Change")).toBeInTheDocument();
    expect(screen.getByText("Move")).toBeInTheDocument();
    expect(screen.getByText("A/D")).toBeInTheDocument();
    expect(screen.getByText("ADX")).toBeInTheDocument();
    expect(screen.getByText("Top Movers")).toBeInTheDocument();
  });

  it("assigns data-testid to each sector row", () => {
    render(() => <SectorTable sectors={mockSectors} />);
    expect(screen.getByTestId("sector-row-it")).toBeInTheDocument();
    expect(screen.getByTestId("sector-row-banking")).toBeInTheDocument();
  });

  it("renders movement bar as Progress component", () => {
    render(() => <SectorTable sectors={mockSectors} />);
    const progressBars = screen.getAllByRole("progressbar");
    expect(progressBars.length).toBe(2);
  });

  it("labels each MOVE bar with its signed delta", () => {
    render(() => <SectorTable sectors={mockSectors} />);
    const deltas = screen.getAllByTestId("sector-move-delta");
    expect(deltas.map((node) => node.textContent)).toEqual(["Δ +2.50%", "Δ -1.00%"]);
  });

  it("rounds a tiny negative change to 0.00% instead of -0.00%", () => {
    render(() => <SectorTable sectors={[{ ...mockSectors[0], avg_change: -0.001 }]} />);
    expect(screen.getAllByText("0.00%").length).toBeGreaterThan(0);
    expect(screen.queryByText("-0.00%")).not.toBeInTheDocument();
    expect(screen.getByTestId("sector-move-delta")).toHaveTextContent("Δ 0.00%");
  });

  it("renders A/D ratio with positive sector green color and negative red", () => {
    render(() => <SectorTable sectors={mockSectors} />);
    expect(screen.getByText("30 : 20")).toBeInTheDocument();
    expect(screen.getByText("15 : 25")).toBeInTheDocument();
  });
});

describe("SectorTable horizontal overflow", () => {
  it("sets a minimum table width wider than a 390px viewport so later columns scroll", () => {
    render(() => <SectorTable sectors={mockSectors} />);
    expect(SECTOR_TABLE_MIN_WIDTH).toBeGreaterThan(390);
    expect(screen.getByTestId("sector-table")).toHaveStyle({ "min-width": `${SECTOR_TABLE_MIN_WIDTH}px` });
  });

  it("keeps the A/D values and numeric cells intact rather than ellipsising them", () => {
    render(() => <SectorTable sectors={mockSectors} />);
    expect(screen.getByText("30 : 20")).toHaveClass("whitespace-nowrap");
    expect(screen.getByText("+2.50%")).toHaveClass("whitespace-nowrap");
    expect(screen.getByText("15 : 25")).toHaveTextContent("15 : 25");
  });

  it("pins the SECTOR column while the remaining columns scroll", () => {
    render(() => <SectorTable sectors={mockSectors} />);
    const stickyRule = screen.getByTestId("sector-table-sticky-style").textContent ?? "";
    expect(stickyRule).toContain('[data-testid="sector-table"] td:first-child');
    expect(stickyRule).toContain("position: sticky");
    expect(stickyRule).toContain("left: 0");
  });
});

describe("SectorTable top mover clickability", () => {
  it("opens the dock from a parsed top mover with no raw /chart anchor", () => {
    const open = vi.fn();
    const sectors: SectorItem[] = [
      { ...mockSectors[0]!, top_movers: "RELIANCE(1.20%), ONGC(0.80%)" },
    ];
    render(() => (
      <UIProvider>
        <SymbolDockContext.Provider
          value={{
            open,
            preview: vi.fn(),
            endPreview: vi.fn(),
            close: vi.fn(),
            pinned: false,
            setOutlet: vi.fn(),
          }}
        >
          <SectorTable sectors={sectors} />
        </SymbolDockContext.Provider>
      </UIProvider>
    ));

    const button = screen.getByTestId("sector-top-mover-RELIANCE");
    expect(button.tagName).toBe("BUTTON");
    expect(document.querySelector('a[href="/chart/RELIANCE"]')).toBeNull();
    expect(screen.getByText("(1.20%)")).toBeInTheDocument();

    fireEvent.click(button);
    expect(open).toHaveBeenCalledWith("RELIANCE", "chart", undefined);
  });
});

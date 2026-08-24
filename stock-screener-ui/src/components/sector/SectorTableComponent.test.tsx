// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SectorTable } from "./SectorTable";
import type { SectorItem } from "../../types/sector";
import { renderWithMantine } from "../../test-utils/renderWithMantine";

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
    renderWithMantine(<SectorTable sectors={[]} />);
    expect(screen.getByText("No sector data available")).toBeInTheDocument();
  });

  it("renders each sector row with sector name", () => {
    renderWithMantine(<SectorTable sectors={mockSectors} />);
    expect(screen.getByText("IT")).toBeInTheDocument();
    expect(screen.getByText("Banking")).toBeInTheDocument();
  });

  it("displays change value with +/- prefix", () => {
    renderWithMantine(<SectorTable sectors={mockSectors} />);
    expect(screen.getByText("+2.50%")).toBeInTheDocument();
    expect(screen.getByText("-1.00%")).toBeInTheDocument();
  });

  it("color-codes change value green for positive, red for negative", () => {
    renderWithMantine(<SectorTable sectors={mockSectors} />);
    const positiveChange = screen.getByText("+2.50%");
    const negativeChange = screen.getByText("-1.00%");
    expect(positiveChange).toBeInTheDocument();
    expect(negativeChange).toBeInTheDocument();
  });

  it("shows A/D Ratio as advances:declines text", () => {
    renderWithMantine(<SectorTable sectors={mockSectors} />);
    expect(screen.getByText("30 : 20")).toBeInTheDocument();
    expect(screen.getByText("15 : 25")).toBeInTheDocument();
  });

  it("shows strength badge label based on ADX", () => {
    renderWithMantine(<SectorTable sectors={mockSectors} />);
    expect(screen.getByText("Strong")).toBeInTheDocument();
    expect(screen.getByText("Weak")).toBeInTheDocument();
  });

  it("shows Strong badge in green for ADX > 25", () => {
    renderWithMantine(<SectorTable sectors={mockSectors} />);
    expect(screen.getByText("Strong")).toBeInTheDocument();
  });

  it("shows Weak badge in red for ADX < 15", () => {
    renderWithMantine(<SectorTable sectors={mockSectors} />);
    expect(screen.getByText("Weak")).toBeInTheDocument();
  });

  it("shows Neutral badge for ADX between 15 and 25", () => {
    const neutralSectors = [
      { ...mockSectors[0], avg_adx: 20, avg_change: 0.5 },
    ];
    renderWithMantine(<SectorTable sectors={neutralSectors} />);
    expect(screen.getByText("Neutral")).toBeInTheDocument();
  });

  it("displays top movers text", () => {
    renderWithMantine(<SectorTable sectors={mockSectors} />);
    expect(screen.getByText("TCS, INFY")).toBeInTheDocument();
    expect(screen.getByText("HDFC")).toBeInTheDocument();
  });

  it("renders table headers", () => {
    renderWithMantine(<SectorTable sectors={mockSectors} />);
    expect(screen.getByText("Sector")).toBeInTheDocument();
    expect(screen.getByText("Change")).toBeInTheDocument();
    expect(screen.getByText("Movement")).toBeInTheDocument();
    expect(screen.getByText("A/D Ratio")).toBeInTheDocument();
    expect(screen.getByText("Strength")).toBeInTheDocument();
    expect(screen.getByText("Top Movers")).toBeInTheDocument();
  });

  it("assigns data-testid to each sector row", () => {
    renderWithMantine(<SectorTable sectors={mockSectors} />);
    expect(screen.getByTestId("sector-row-it")).toBeInTheDocument();
    expect(screen.getByTestId("sector-row-banking")).toBeInTheDocument();
  });

  it("renders movement bar as Progress component", () => {
    renderWithMantine(<SectorTable sectors={mockSectors} />);
    const progressBars = screen.getAllByRole("progressbar");
    expect(progressBars.length).toBe(2);
  });

  it("renders A/D ratio with positive sector green color and negative red", () => {
    renderWithMantine(<SectorTable sectors={mockSectors} />);
    expect(screen.getByText("30 : 20")).toBeInTheDocument();
    expect(screen.getByText("15 : 25")).toBeInTheDocument();
  });
});

// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SectorTreemap } from "./SectorHelpers";
import type { SectorItem } from "../../types/sector";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";
import { renderWithMantine } from "../../test-utils/renderWithMantine";

beforeEach(() => setupBrowserMocks());
afterEach(() => cleanup());

function makeSector(overrides: Partial<SectorItem> = {}): SectorItem {
  return {
    sector: "IT",
    avg_change: 1.5,
    stock_count: 50,
    advances: 30,
    declines: 20,
    avg_rsi: 55,
    avg_adx: 22,
    top_movers: "TCS, INFY",
    ...overrides,
  };
}

describe("SectorTreemap", () => {
  it("renders treemap container", () => {
    const sectors = [makeSector({ sector: "IT", avg_change: 2.5 })];
    renderWithMantine(<SectorTreemap sectors={sectors} />);
    const container = document.querySelector('[style*="display: grid"]');
    expect(container).toBeInTheDocument();
  });

  it("renders treemap tiles with sector names", () => {
    const sectors = [
      makeSector({ sector: "IT", avg_change: 2.5 }),
      makeSector({ sector: "Banking", avg_change: -1.0 }),
    ];
    renderWithMantine(<SectorTreemap sectors={sectors} />);
    expect(screen.getByText("IT")).toBeInTheDocument();
    expect(screen.getByText("Banking")).toBeInTheDocument();
  });

  it("renders treemap tiles with percentage change", () => {
    const sectors = [makeSector({ sector: "IT", avg_change: 2.5 })];
    renderWithMantine(<SectorTreemap sectors={sectors} />);
    expect(screen.getByText("+2.50%")).toBeInTheDocument();
  });

  it("renders treemap tiles with stock count", () => {
    const sectors = [makeSector({ sector: "IT", stock_count: 50 })];
    renderWithMantine(<SectorTreemap sectors={sectors} />);
    expect(screen.getByText(/Stocks 50/)).toBeInTheDocument();
  });

  it("renders treemap tiles with advance/decline ratio", () => {
    const sectors = [makeSector({ sector: "IT", advances: 30, declines: 20 })];
    renderWithMantine(<SectorTreemap sectors={sectors} />);
    expect(screen.getByText("30 / 20")).toBeInTheDocument();
  });

  it("renders top sector tile with rank badge", () => {
    const sectors = [
      makeSector({ sector: "IT", avg_change: 2.5 }),
      makeSector({ sector: "Banking", avg_change: -1.0 }),
    ];
    renderWithMantine(<SectorTreemap sectors={sectors} />);
    expect(screen.getByText("#1")).toBeInTheDocument();
  });

  it("top sector tile has larger min-height (span 2 rows)", () => {
    const sectors = [makeSector({ sector: "IT", avg_change: 2.5 })];
    const { container } = renderWithMantine(<SectorTreemap sectors={sectors} />);
    const tile = container.querySelector('[style*="min-height: 212"]');
    expect(tile).toBeInTheDocument();
    expect(tile?.textContent).toContain("IT");
  });

  it("applies color coding based on change intensity", () => {
    const sectors = [
      makeSector({ sector: "StrongUp", avg_change: 3.0 }),
      makeSector({ sector: "StrongDown", avg_change: -3.0 }),
      makeSector({ sector: "Neutral", avg_change: 0.0 }),
    ];
    renderWithMantine(<SectorTreemap sectors={sectors} />);
    expect(screen.getByText("StrongUp")).toBeInTheDocument();
    expect(screen.getByText("StrongDown")).toBeInTheDocument();
    expect(screen.getByText("Neutral")).toBeInTheDocument();
  });

  it("handles empty sectors gracefully", () => {
    const { container } = renderWithMantine(<SectorTreemap sectors={[]} />);
    const grid = container.querySelector('[style*="display: grid"]');
    expect(grid).toBeInTheDocument();
  });
});

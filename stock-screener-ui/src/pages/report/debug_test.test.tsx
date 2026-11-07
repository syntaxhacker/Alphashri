import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IndexMoversModal } from "./IndexMoversModal";
import { fetchIndexMovers, IndexMoversResponse } from "@/api/indexMovers";

vi.mock("@/api/indexMovers", () => ({
  fetchIndexMovers: vi.fn(),
}));

const mockFetchIndexMovers = vi.mocked(fetchIndexMovers);

const createMockResponse = (overrides: Partial<IndexMoversResponse> = {}): IndexMoversResponse => ({
  index: "NIFTY",
  as_of: new Date().toISOString(),
  stale: false,
  source: "NIFTY50_WEIGHTS (Tickertape 2026-10-15)",
  gainers: [{ symbol: "HDFCBANK", ltp: 1750.0, change_pct: 1.92, contribution_pct: 0.206, volume: 1234567 }],
  losers: [{ symbol: "TCS", ltp: 3450.0, change_pct: -2.52, contribution_pct: -0.058, volume: 987654 }],
  live_only: false,
  ...overrides,
});

describe("Debug", () => {
  it("debug title", async () => {
    mockFetchIndexMovers.mockResolvedValue(createMockResponse());
    render(<IndexMoversModal open={true} onClose={vi.fn()} index="NIFTY" />);
    
    // Wait for modal
    await new Promise(r => setTimeout(r, 100));
    
    // Check what's in the DOM
    const modal = screen.getByTestId("panel-modal");
    console.log("Modal innerHTML:", modal.innerHTML.substring(0, 500));
    
    const titleBar = screen.getByTestId("panel-modal-title");
    console.log("Title bar textContent:", titleBar.textContent);
    console.log("Title bar innerHTML:", titleBar.innerHTML);
    
    expect(true).toBe(true);
  });
});
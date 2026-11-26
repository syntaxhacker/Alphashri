// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { RotationDetail } from "./RotationDetail";
import { SymbolDockContext } from "../common/symbolDockContext";
import type { RotationPeriod, RotationRow } from "../../types/rotation";

const returns = Object.fromEntries(
  (["1D", "1W", "1M", "3M", "6M", "YTD", "1Y"] as RotationPeriod[]).map((key) => [key, 1.2]),
) as Record<RotationPeriod, number>;

const row: RotationRow = {
  id: "theme:defence",
  name: "Defence",
  kind: "theme",
  slug: "defence",
  category: "Industrials",
  members: 25,
  covered: 25,
  returns,
  rs_1m: 9.1,
  rs_1w: 3.2,
  rs_pct: 82,
  mom_pct: 74,
  rank: 1,
  rank_delta: 4,
  breadth: 72,
  rel_volume: 1.8,
  quadrant: "leading",
  status: "booming",
  top_movers: [
    { symbol: "HAL", change: 2.4 },
    { symbol: "BEL", change: 1.8 },
  ],
};

function renderDetail(open: (...args: unknown[]) => void, market?: string) {
  return render(() => (
    <UIProvider>
      <SymbolDockContext.Provider
        value={{
          open: open as never,
          preview: vi.fn(),
          endPreview: vi.fn(),
          close: vi.fn(),
          pinned: false,
          setOutlet: vi.fn(),
        }}
      >
        <RotationDetail row={row} onOpenMembers={vi.fn()} market={market} />
      </SymbolDockContext.Provider>
    </UIProvider>
  ));
}

afterEach(() => {
  cleanup();
});

describe("RotationDetail mover clickability", () => {
  test("movers are dock buttons, not raw /chart anchors", () => {
    const open = vi.fn();
    renderDetail(open);

    const hal = screen.getByTestId("rotation-mover-HAL");
    expect(hal.tagName).toBe("BUTTON");
    expect(hal).toHaveAttribute("aria-label", "Open HAL chart");
    expect(document.querySelector('a[href="/chart/HAL"]')).toBeNull();

    fireEvent.click(hal);
    expect(open).toHaveBeenCalledWith("HAL", "chart", undefined);
  });

  test("forwards a market tag so US movers use the US chart provider", () => {
    const open = vi.fn();
    renderDetail(open, "usa");

    fireEvent.click(screen.getByTestId("rotation-mover-BEL"));
    expect(open).toHaveBeenCalledWith("BEL", "chart", "usa");
  });
});

// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { RotationDetail } from "./RotationDetail";
import { SymbolDockContext } from "../common/symbolDockContext";
import type { RotationPeriod, RotationRow } from "../../types/rotation";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const returns = {
  "1D": 1,
  "1W": 2,
  "1M": 3,
  "3M": 4,
  "6M": 5,
  YTD: 6,
  "1Y": 7,
} as Record<RotationPeriod, number>;

const flatReturns = Object.fromEntries(
  (["1D", "1W", "1M", "3M", "6M", "YTD", "1Y"] as RotationPeriod[]).map((key) => [key, 1.2]),
) as Record<RotationPeriod, number>;

const rowWithMover = (symbol: string): RotationRow => ({
  id: "sector:technology",
  name: "Technology",
  kind: "sector",
  members: 88,
  covered: 88,
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
  top_movers: [{ symbol, change: 2.4 }],
});

const row: RotationRow = {
  id: "theme:defence",
  name: "Defence",
  kind: "theme",
  slug: "defence",
  category: "Industrials",
  members: 25,
  covered: 25,
  returns: flatReturns,
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

describe("RotationDetail mover links", () => {
  test("renders a decorated mover as a bare ticker with a canonical in-app chart href", () => {
    render(() => (
      <RotationDetail row={rowWithMover("NSE:RELIANCE")} onOpenMembers={vi.fn()} />
    ));

    const link = screen.getByRole("link", { name: "RELIANCE" });
    expect(link).toHaveAttribute("href", "/chart/RELIANCE");
    expect(link).toHaveTextContent("RELIANCE");
    expect(link.getAttribute("href")).not.toContain("NSE%3A");
    expect(document.body.textContent).not.toContain("NSE:");
  });

  test("keeps a US share-class dot in the in-app chart href", () => {
    render(() => <RotationDetail row={rowWithMover("BRK.B")} onOpenMembers={vi.fn()} />);

    const link = screen.getByRole("link", { name: "BRK.B" });
    expect(link).toHaveAttribute("href", "/chart/BRK.B");
  });

  test("activates a decorated mover chart link with Space", () => {
    render(() => <RotationDetail row={rowWithMover("NSE:RELIANCE")} onOpenMembers={vi.fn()} />);
    const link = screen.getByRole("link", { name: "RELIANCE" });
    const click = vi.spyOn(link, "click").mockImplementation(() => {});
    fireEvent.keyDown(link, { key: " " });
    expect(click).toHaveBeenCalledTimes(1);
  });

  test("copies the display symbol beside a decorated mover link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(() => <RotationDetail row={rowWithMover("NSE:RELIANCE")} onOpenMembers={vi.fn()} />);

    const copy = screen.getByTestId("copy-symbol-RELIANCE");
    expect(copy).toHaveAttribute("aria-label", "Copy RELIANCE");
    await fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith("RELIANCE");
  });

  test("copies a dock-backed mover without opening its chart", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const open = vi.fn();
    renderDetail(open);

    const copy = screen.getByTestId("symbol-copy-HAL");
    expect(copy).toHaveAttribute("aria-label", "Copy HAL");
    await fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith("HAL");
    expect(open).not.toHaveBeenCalled();
  });
});

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

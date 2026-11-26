// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { RotationDetail } from "./RotationDetail";
import type { RotationRow } from "../../types/rotation";

afterEach(() => cleanup());

const returns = {
  "1D": 1,
  "1W": 2,
  "1M": 3,
  "3M": 4,
  "6M": 5,
  YTD: 6,
  "1Y": 7,
};

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
});

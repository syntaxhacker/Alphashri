// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { PivotList } from "./PatternPivotList";


afterEach(() => cleanup());

describe("PatternPivotList", () => {
  test("renders nothing without pivots", () => {
    const { container } = render(() => <PivotList pivots={[]} />);
    expect(container.querySelector('[data-testid="patterns-detail-pivots"]')).toBeNull();
  });

  test("renders nothing when pivots is undefined", () => {
    const { container } = render(() => <PivotList pivots={undefined} />);
    expect(container.querySelector('[data-testid="patterns-detail-pivots"]')).toBeNull();
  });

  test("renders nothing when the pivots prop is omitted", () => {
    const { container } = render(() => <PivotList />);
    expect(container.querySelector('[data-testid="patterns-detail-pivots"]')).toBeNull();
  });

  test("lists each pivot with readable date, price and kind plus the count", () => {
    render(() =>       <PivotList
        pivots={[
          { t: "2026-05-04", price: 1234.5, kind: "high" },
          { t: "2026-05-20", price: 1180, kind: "low" },
        ]}
      />);
    expect(screen.getByTestId("patterns-detail-pivot-0")).toHaveTextContent("04 May 2026 · ₹1234.50 · High");
    expect(screen.getByTestId("patterns-detail-pivot-1")).toHaveTextContent("20 May 2026 · ₹1180.00 · Low");
    expect(screen.getByTestId("patterns-detail-pivots")).toHaveTextContent("(2)");
  });

  test("is collapsed by default and toggles open/closed", async () => {
    render(() => <PivotList pivots={[{ t: "2026-05-04", price: 100, kind: "low" }]} />);
    const toggle = screen.getByTestId("patterns-detail-pivots-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("patterns-detail-pivot-0")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("shows an em dash for pivots with a missing price", () => {
    render(() =>       <PivotList
        pivots={[{ t: "2026-05-04", price: null as unknown as number, kind: "high" }]}
      />);
    expect(screen.getByTestId("patterns-detail-pivot-0")).toHaveTextContent("—");
    expect(screen.getByTestId("patterns-detail-pivot-0")).toHaveTextContent("High");
  });

  test("defaults a pivot with a missing kind to High", () => {
    render(() =>       <PivotList
        pivots={[{ t: "2026-05-04", price: 100 } as { t: string; price: number; kind?: "high" | "low" }]}
      />);
    expect(screen.getByTestId("patterns-detail-pivot-0")).toHaveTextContent("High");
  });
});

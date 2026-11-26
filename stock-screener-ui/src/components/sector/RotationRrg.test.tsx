// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { RotationRow } from "../../types/rotation";
import { RotationRrg } from "./RotationRrg";

const returns = {
  "1D": 1,
  "1W": 2,
  "1M": 3,
  "3M": 4,
  "6M": 5,
  YTD: 6,
  "1Y": 7,
};

function row(overrides: Partial<RotationRow>): RotationRow {
  return {
    id: "sector:x",
    name: "X",
    kind: "sector",
    category: "X",
    members: 10,
    covered: 10,
    returns,
    rs_1m: 1,
    rs_1w: 1,
    rs_pct: 50,
    mom_pct: 50,
    rank: 1,
    rank_delta: 0,
    breadth: 50,
    rel_volume: 1,
    quadrant: "leading",
    status: "neutral",
    top_movers: [],
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("RotationRrg quadrant labels", () => {
  test("keeps quadrant labels by the crosshair and clear of the month axis", () => {
    render(() => (
      <UIProvider>
        <RotationRrg
          rows={[
            row({ id: "leading", name: "Lead", rs_pct: 70, mom_pct: 70, quadrant: "leading" }),
            row({ id: "lagging", name: "Lag", rs_pct: 30, mom_pct: 30, quadrant: "lagging" }),
          ]}
          selectedId={null}
          onSelect={() => {}}
        />
      </UIProvider>
    ));

    const leading = screen.getAllByText("LEADING").find((node) => node.style.bottom === "4px")!;
    const lagging = screen.getAllByText("LAGGING").find((node) => node.style.top === "4px")!;
    expect(leading).toBeDefined();
    expect(lagging).toBeDefined();
    expect(leading).toHaveStyle({ bottom: "4px", right: "12px" });
    expect(lagging).toHaveStyle({ top: "4px", left: "12px" });
    expect(leading.style.top).toBe("auto");
    expect(lagging.style.bottom).toBe("auto");
  });

  test("renders a compact legend naming every plotted sector", () => {
    render(() => (
      <UIProvider>
        <RotationRrg
          rows={[
            row({ id: "technology", name: "Technology", quadrant: "leading" }),
            row({ id: "financials", name: "Financials", quadrant: "improving" }),
            row({ id: "energy", name: "Energy", quadrant: "lagging" }),
          ]}
          selectedId={null}
          onSelect={() => {}}
        />
      </UIProvider>
    ));

    const legend = screen.getByTestId("rotation-rrg-legend");
    expect(legend).toHaveClass("sm:hidden");
    expect(legend).toHaveClass("flex-wrap");
    expect(legend).toHaveTextContent("Technology");
    expect(legend).toHaveTextContent("Financials");
    expect(legend).toHaveTextContent("Energy");
  });

  test("survives a group with an unknown quadrant colour", () => {
    const broken = row({
      id: "broken",
      name: "Broken",
      quadrant: undefined as unknown as RotationRow["quadrant"],
      rs_pct: 50,
      mom_pct: 50,
    });

    expect(() =>
      render(() => (
        <UIProvider>
          <RotationRrg rows={[broken]} selectedId={null} onSelect={() => {}} />
        </UIProvider>
      )),
    ).not.toThrow();

    const dot = screen.getByRole("button", { name: /Broken/ });
    expect(dot.style.backgroundColor).toMatch(/^rgba\(/);
    expect(dot.style.border).toContain("rgba(");
  });
});

// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { SRZoneSummary, srZoneSummaryText } from "./SRZoneSummary";
import type { TVRect } from "./patternTVData";

type Zone = TVRect & { bars_since_touch?: number };

function zone(overrides: Partial<Zone> = {}): Zone {
  return {
    kind: "support",
    top: 101,
    bottom: 99,
    start: 100,
    end: 200,
    touches: 3,
    score: 0.8,
    color: "support-token",
    legendName: "Support",
    ...overrides,
  };
}

describe("SRZoneSummary", () => {
  afterEach(() => cleanup());

  test("screen-reader list carries kind, price band and touches as real text", () => {
    render(() => (
      <SRZoneSummary
        zones={[
          zone(),
          zone({
            kind: "resistance",
            top: 2560,
            bottom: 2540,
            touches: 2,
            legendName: "Resistance",
          }),
          zone({ kind: "sr", top: 110, bottom: 108, touches: 1, legendName: "S/R" }),
        ]}
      />
    ));

    const section = screen.getByTestId("sr-zone-summary");
    expect(section).toHaveClass("sr-only");
    expect(section).not.toHaveAttribute("aria-label");
    expect(section).toHaveTextContent("Support and resistance levels");
    const list = within(section).getByRole("list");
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Support: ₹99.00 to ₹101.00, 3 touches",
      "Resistance: ₹2540.00 to ₹2560.00, 2 touches",
      "S/R: ₹108.00 to ₹110.00, 1 touch",
    ]);
  });

  test("recency appears only when bars_since_touch is present, with singular/plural bars", () => {
    render(() => (
      <SRZoneSummary
        zones={[
          zone(),
          zone({ bars_since_touch: 2, legendName: "Resistance", kind: "resistance" }),
          zone({ bars_since_touch: 1, legendName: "S/R", kind: "sr" }),
        ]}
      />
    ));
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Support: ₹99.00 to ₹101.00, 3 touches",
      "Resistance: ₹99.00 to ₹101.00, 3 touches, last touched 2 bars ago",
      "S/R: ₹99.00 to ₹101.00, 3 touches, last touched 1 bar ago",
    ]);
  });

  test("non-finite or non-numeric recency is omitted", () => {
    expect(srZoneSummaryText(zone({ bars_since_touch: NaN }))).toBe(
      "Support: ₹99.00 to ₹101.00, 3 touches",
    );
    expect(
      srZoneSummaryText(zone({ bars_since_touch: "4" } as unknown as Partial<Zone>)),
    ).toBe("Support: ₹99.00 to ₹101.00, 3 touches");
  });

  test("US market formats both ends of the band in dollars", () => {
    render(() => (
      <SRZoneSummary
        market="usa"
        zones={[zone({ bottom: 1234.5, top: 1235.5 })]}
      />
    ));
    expect(screen.getByRole("listitem")).toHaveTextContent(
      "Support: $1,234.50 to $1,235.50, 3 touches",
    );
    expect(screen.getByTestId("sr-zone-summary").textContent).not.toContain("₹");
  });

  test("visible mode uses a native disclosure with the same real list", () => {
    render(() => <SRZoneSummary zones={[zone()]} visible testId="levels-summary" />);
    const details = screen.getByTestId("levels-summary");
    expect(details.tagName).toBe("DETAILS");
    expect(within(details).getByText("Levels").tagName).toBe("SUMMARY");
    expect(details).not.toHaveClass("sr-only");
    expect(details.className).not.toContain("border");
    expect(within(details).getByRole("listitem")).toHaveTextContent(
      "Support: ₹99.00 to ₹101.00, 3 touches",
    );
  });

  test("no built zones means no summary at all", () => {
    render(() => <SRZoneSummary zones={[]} />);
    expect(screen.queryByTestId("sr-zone-summary")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

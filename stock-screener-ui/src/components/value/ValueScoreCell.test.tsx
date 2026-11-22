// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { ValueScoreCell } from "./ValueScoreCell";
import type { ValuePeer, ValueSubscores } from "../../api/valueScan";

const PEER: ValuePeer = {
  bucket: "Refining",
  pe_median: 11.2,
  roe_median: 12,
  fcf_yield_median: 4.1,
};

function renderCell(subscores: ValueSubscores, symbol = "TEST") {
  return render(() => (
    <UIProvider>
      <ValueScoreCell score={78} subscores={subscores} peer={PEER} symbol={symbol} />
    </UIProvider>
  ));
}

function fillHeight(symbol: string, key: string): string {
  return (screen.getByTestId(`value-score-bar-${symbol}-${key}`) as HTMLElement).style.height;
}

afterEach(cleanup);

describe("ValueScoreCell subscore bars", () => {
  test("a 25/25 subscore fills the bar and 0 fills none", () => {
    renderCell({ value: 25, quality: 0, growth: 25, health: 0 });
    expect(fillHeight("TEST", "value")).toBe("100%");
    expect(fillHeight("TEST", "quality")).toBe("0%");
    expect(fillHeight("TEST", "growth")).toBe("100%");
    expect(fillHeight("TEST", "health")).toBe("0%");
  });

  test("a midpoint subscore fills half the bar", () => {
    renderCell({ value: 12.5, quality: 0, growth: 0, health: 0 });
    expect(fillHeight("TEST", "value")).toBe("50%");
  });

  test("malformed subscores never overflow the bar", () => {
    renderCell({
      value: 999,
      quality: -5,
      growth: Number.NaN,
      health: undefined as unknown as number,
    });
    expect(fillHeight("TEST", "value")).toBe("100%");
    expect(fillHeight("TEST", "quality")).toBe("0%");
    expect(fillHeight("TEST", "growth")).toBe("0%");
    expect(fillHeight("TEST", "health")).toBe("0%");
  });

  test("the tooltip still lists all four subscores and the peer medians", () => {
    renderCell({ value: 25, quality: 0, growth: 12.5, health: 0 });
    const wrapper = screen.getByTestId("value-score-TEST").parentElement as HTMLElement;
    const label = wrapper.getAttribute("aria-label") ?? "";
    expect(label).toContain("Value 25");
    expect(label).toContain("Quality 0");
    expect(label).toContain("Growth 12.5");
    expect(label).toContain("Health 0");
    expect(label).toContain("Peer Refining");
  });
});

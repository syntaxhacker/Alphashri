// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { DockLeg } from "@/state/optionsDock";
import { LegBuilder } from "./LegBuilder";

function leg(side: "buy" | "sell"): DockLeg {
  return {
    key: "CE|24200",
    expiry: "2026-03-26",
    side,
    type: "CE",
    strike: 24200,
    premium: 36.6,
    lots: 1,
    lotSize: 65,
  };
}

afterEach(() => cleanup());

describe("LegBuilder theme-sensitive chips", () => {
  test("the BUY B uses the positive token on the raised surface", () => {
    render(() => (
      <UIProvider>
        <LegBuilder legs={[leg("buy")]} netPremium={36.6} currentExpiry="2026-03-26" />
      </UIProvider>
    ));
    const chip = screen.getByTestId("options-leg-side-CE-24200");
    expect(chip).toHaveTextContent("B");
    expect(chip.style.color).toBe("var(--color-fin-positive)");
    expect(chip.style.color).not.toMatch(/^#/);
  });

  test("the SELL S uses the negative token on the raised surface", () => {
    render(() => (
      <UIProvider>
        <LegBuilder legs={[leg("sell")]} netPremium={36.6} currentExpiry="2026-03-26" />
      </UIProvider>
    ));
    const chip = screen.getByTestId("options-leg-side-CE-24200");
    expect(chip).toHaveTextContent("S");
    expect(chip.style.color).toBe("var(--color-fin-negative)");
    expect(chip.style.color).not.toMatch(/^#/);
  });
});

describe("LegBuilder type scale and gaps", () => {
  test("leg chips are 11px, gapped by 8px and separated by a subtle border", () => {
    render(() => (
      <UIProvider>
        <LegBuilder legs={[leg("buy")]} netPremium={36.6} currentExpiry="2026-03-26" />
      </UIProvider>
    ));
    const chips = screen.getByTestId("options-leg-chips");
    expect(chips.className).toContain("gap-2");

    const chip = screen.getByTestId("options-leg-CE-24200");
    expect(chip.className).toContain("gap-2");
    expect(chip.className).toContain("rounded-md");
    expect(chip.className).toContain("border-fin-border-subtle");
    for (const el of chip.querySelectorAll("span, button")) {
      expect(el.getAttribute("style") ?? "").not.toMatch(/font-size:\s*(9|10)px/);
      expect(el.className).not.toContain("text-[9px]");
      expect(el.className).not.toContain("text-[10px]");
    }
  });

  test("meta and empty states render at 11px, not 9/10px", () => {
    render(() => (
      <UIProvider>
        <LegBuilder legs={[]} netPremium={0} currentExpiry="2026-03-26" />
      </UIProvider>
    ));
    const count = screen.getByTestId("options-leg-count");
    expect(count).toHaveTextContent("0/4");
    expect(count.className).toContain("text-[11px]");

    const empty = screen.getByTestId("options-legs-empty");
    expect(empty.className).toContain("text-[11px]");
    expect(empty.getAttribute("style") ?? "").not.toMatch(/font-size/);
  });
});

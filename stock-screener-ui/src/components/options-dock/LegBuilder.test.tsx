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

// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";
import type { ChainLevel, ChainRow, OptionChainLevels } from "@/api/optionsDock";

const { maxPainMock } = vi.hoisted(() => ({ maxPainMock: vi.fn(() => 24000) }));
vi.mock("@/utils/optionsMath", async () => {
  const actual = await vi.importActual<typeof import("@/utils/optionsMath")>("@/utils/optionsMath");
  return { ...actual, maxPain: () => maxPainMock() };
});

import { SummaryStrip } from "./SummaryStrip";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => maxPainMock.mockReset());

function leg(oi: number) {
  return {
    ltp: 100, oi, prevOi: 0, volume: 0, iv: 14, delta: null, gamma: null,
    theta: null, vega: null, pop: null, bid: null, ask: null, instrumentKey: "",
  };
}

const ROWS: ChainRow[] = [23900, 24000, 24100].map((strike) => ({
  strike,
  ce: leg(1_000_000),
  pe: leg(1_000_000),
}));

function level(strike: number, strength: number | null = 0.26): ChainLevel {
  return { strike, side: "below", strength, oi: 100, payout: null, netGex: null };
}

function levelsFixture(overrides: Partial<OptionChainLevels> = {}): OptionChainLevels {
  return {
    spot: 24000,
    step: 100,
    thin: false,
    callWall: { strike: 24100, side: "above", strength: 0.2, oi: 100, payout: null, netGex: null },
    putWall: { strike: 23900, side: "below", strength: 0.15, oi: 90, payout: null, netGex: null },
    callWalls: [],
    putWalls: [],
    maxPain: { strike: 23900, side: "below", strength: 0.31, oi: null, payout: 1000, netGex: null },
    gex: {
      support: { strike: 23800, side: "below", strength: 0.4, oi: null, payout: null, netGex: 0.5 },
      resistance: { strike: 24200, side: "above", strength: 1, oi: null, payout: null, netGex: 2.3 },
      fuelUp: null,
      fuelDown: null,
      flip: 24100,
      regime: "short",
      degraded: false,
    },
    ...overrides,
  };
}

function renderStrip(levels: OptionChainLevels | null, atmIv: number | null = 14) {
  return render(() => (
    <UIProvider>
      <SummaryStrip
        rows={ROWS}
        spot={24000}
        pcr={1}
        atmIv={atmIv}
        dteDays={2}
        dteYears={0.008}
        levels={levels}
      />
    </UIProvider>
  ));
}

function narrowViewport() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width: 639px"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe("SummaryStrip — PAIN source", () => {
  it("reads PAIN from levels.maxPain without recomputing it", () => {
    maxPainMock.mockReturnValue(99999);
    renderStrip(levelsFixture());

    expect(screen.getByTestId("options-stat-max-pain").textContent).toContain("23,900");
    expect(maxPainMock).not.toHaveBeenCalled();
  });

  it("falls back to the computed max pain for a legacy frame", () => {
    maxPainMock.mockReturnValue(24000);
    renderStrip(null);

    expect(screen.getByTestId("options-stat-max-pain").textContent).toContain("24,000");
    expect(maxPainMock).toHaveBeenCalledTimes(1);
  });

  it("shows a dash when levels are present but maxPain is null", () => {
    maxPainMock.mockReturnValue(23900);
    renderStrip(levelsFixture({ maxPain: null }));

    expect(screen.getByTestId("options-stat-max-pain").textContent).toContain("—");
    expect(maxPainMock).not.toHaveBeenCalled();
  });
});

describe("SummaryStrip — σ tooltip", () => {
  it("shows a dash instead of 0.0% when ATM IV is missing", () => {
    renderStrip(levelsFixture(), null);

    const sigma = screen.getByTestId("options-stat-sigma");
    expect(sigma.textContent).toContain("—");
    const tooltip = sigma.parentElement?.getAttribute("aria-label") ?? "";
    expect(tooltip).toContain("× — ×");
    expect(tooltip).not.toContain("0.0%");
  });
});

describe("SummaryStrip — level chips", () => {
  const normColor = (s: string) => s.toLowerCase().replace(/\s/g, "");
  const colorIs = (el: HTMLElement, prop: "color" | "backgroundColor", token: string) => {
    const h = token.replace("#", "");
    const rgb = `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
    return [normColor(token), normColor(rgb)].includes(normColor(el.style[prop]));
  };

  it("renders SUP/RES/PW/CW as chips: coloured dot + label + strike, LEVEL_* tint, TEXT ink", () => {
    renderStrip(levelsFixture());

    const cases: Array<[key: string, strike: string, token: string]> = [
      ["sup", "23,800", palette.LEVEL_SUPPORT],
      ["res", "24,200", palette.LEVEL_RESISTANCE],
      ["pw", "23,900", palette.LEVEL_PUT_WALL],
      ["cw", "24,100", palette.LEVEL_CALL_WALL],
    ];
    for (const [key, strike, token] of cases) {
      const chip = screen.getByTestId(`options-level-${key}`);
      expect(chip.textContent).toContain("●");
      expect(chip.textContent).toContain(key.toUpperCase());
      expect(chip.textContent).toContain(strike);
      expect(chip.getAttribute("title")).toContain(strike);

      const dot = screen.getByTestId(`options-level-dot-${key}`);
      expect(dot.textContent).toBe("●");
      expect(colorIs(dot, "color", token)).toBe(true);

      // 10% tint from the level token, never a solid fill behind the text.
      expect(normColor(chip.style.backgroundColor)).toBe(normColor(palette.alpha(token, 0.10)));
      // The ink is TEXT (high contrast), not the level colour.
      expect(colorIs(chip, "color", palette.TEXT)).toBe(true);
      expect(colorIs(chip, "color", token)).toBe(false);
    }
  });

  it("uses plain-language tooltips naming the level, strike and confidence", () => {
    renderStrip(levelsFixture());

    expect(screen.getByTestId("options-level-sup").getAttribute("title")).toBe("Gamma support 23,800 · 40% confidence");
    expect(screen.getByTestId("options-level-res").getAttribute("title")).toBe("Gamma resistance 24,200 · 100% confidence");
    expect(screen.getByTestId("options-level-pw").getAttribute("title")).toBe("Put wall 23,900 · 15% confidence");
    expect(screen.getByTestId("options-level-cw").getAttribute("title")).toBe("Call wall 24,100 · 20% confidence");
  });

  it("keeps only SUP/RES chips at a 390px viewport", () => {
    narrowViewport();
    renderStrip(levelsFixture());

    const line = screen.getByTestId("options-levels-line");
    expect(line.textContent).toContain("SUP");
    expect(line.textContent).toContain("RES");
    expect(screen.queryByTestId("options-level-pw")).not.toBeInTheDocument();
    expect(screen.queryByTestId("options-level-cw")).not.toBeInTheDocument();
  });

  it("keeps PAIN as the single max-pain value and adds no max-pain chip", () => {
    renderStrip(levelsFixture());

    expect(screen.getByTestId("options-stat-max-pain").textContent).toContain("23,900");
    expect(screen.queryByTestId("options-level-mp")).not.toBeInTheDocument();
    expect(screen.queryByTestId("options-level-max-pain")).not.toBeInTheDocument();
    expect(screen.getByTestId("options-levels-line").textContent).not.toContain("MP");
  });

  it("is market-agnostic: India and US level sets render independently from props", () => {
    const base = levelsFixture().gex;
    const india = levelsFixture({
      gex: { ...base, support: level(24000), resistance: level(24500) },
      putWall: level(23800),
      callWall: level(24200),
    });
    const us = levelsFixture({
      gex: { ...base, support: level(5000), resistance: level(5100) },
      putWall: level(4900),
      callWall: level(5200),
    });

    const indiaView = renderStrip(india);
    const usView = renderStrip(us);
    const indiaLine = within(indiaView.container).getByTestId("options-levels-line");
    const usLine = within(usView.container).getByTestId("options-levels-line");

    expect(within(indiaLine).getByTestId("options-level-sup").textContent).toContain("24,000");
    expect(within(indiaLine).getByTestId("options-level-cw").textContent).toContain("24,200");
    expect(within(usLine).getByTestId("options-level-sup").textContent).toContain("5,000");
    expect(within(usLine).getByTestId("options-level-pw").textContent).toContain("4,900");
    expect(indiaLine).not.toBe(usLine);
  });

  it("hides the line when every level is null", () => {
    const empty = levelsFixture({
      callWall: null,
      putWall: null,
      maxPain: null,
      gex: {
        support: null, resistance: null, fuelUp: null, fuelDown: null,
        flip: null, regime: "flat", degraded: true,
      },
    });
    renderStrip(empty);

    expect(screen.queryByTestId("options-levels-line")).not.toBeInTheDocument();
  });

  it("shows the thin-chain warning instead of the level line when thin", () => {
    renderStrip(levelsFixture({ thin: true }));

    expect(screen.getByTestId("options-thin-chain")).toBeVisible();
    expect(screen.queryByTestId("options-levels-line")).not.toBeInTheDocument();
  });
});

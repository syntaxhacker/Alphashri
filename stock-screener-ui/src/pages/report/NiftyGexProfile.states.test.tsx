// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import * as palette from "@/ui/palette";
import {
  NiftyGexProfile,
  formatGexCr,
  formatGexStrike,
  gexLevelTone,
  gexTone,
} from "./NiftyGexProfile";
import { TestWrapper, gex } from "./NiftyGexProfile.fixtures";

describe("format helpers", () => {
  test("formatGexCr signs and fixes to 2 dp with the Cr/pt unit, dashes absent values", () => {
    expect(formatGexCr(7.5)).toBe("+7.50 Cr/pt");
    expect(formatGexCr(-8)).toBe("-8.00 Cr/pt");
    expect(formatGexCr(0)).toBe("0.00 Cr/pt");
    expect(formatGexCr(null)).toBe("—");
  });

  test("formatGexStrike groups Indian-style and dashes absent values", () => {
    expect(formatGexStrike(22650)).toBe("22,650");
    expect(formatGexStrike(null)).toBe("—");
  });

  test("gexTone maps sign to palette tokens", () => {
    expect(gexTone(3)).toBe(palette.TERM_GAMMA);
    expect(gexTone(-3)).toBe(palette.TERM_GAMMA_NEG);
    expect(gexTone(0)).toBe(palette.TEXT_MUTED);
    expect(gexTone(null)).toBe(palette.TEXT_MUTED);
  });

  test("gexLevelTone uses the level tokens for SUP/RES, not the gamma sign", () => {
    expect(gexLevelTone({ strike: 22600, netGex: 12, kind: "support", side: "below" })).toBe(
      palette.LEVEL_SUPPORT,
    );
    expect(gexLevelTone({ strike: 22800, netGex: 11, kind: "resistance", side: "above" })).toBe(
      palette.LEVEL_RESISTANCE,
    );
    expect(gexLevelTone({ strike: 22500, netGex: -20, kind: "fuel", side: "below" })).toBe(
      palette.TERM_GAMMA_NEG,
    );
    expect(gexLevelTone(null)).toBe(palette.TEXT_MUTED);
    expect(palette.LEVEL_SUPPORT).toBe(palette.POSITIVE_COLOR);
    expect(palette.LEVEL_RESISTANCE).toBe(palette.NEGATIVE_COLOR);
  });
});

describe("NiftyGexProfile render", () => {
  test("undefined gex shows the empty state and never crashes", () => {
    render(() => <NiftyGexProfile spot={22700} />, { wrapper: TestWrapper });

    expect(screen.getByTestId("nifty-gex-profile-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-gex-profile-chart")).toBeInTheDocument();
    expect(screen.getByText("No per-strike GEX profile")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-gex-profile-net")).toHaveTextContent("—");
    expect(screen.getByTestId("nifty-gex-profile-regime")).toHaveTextContent("—");
  });

  test("empty strike list also renders the empty state", () => {
    render(() => <NiftyGexProfile gex={gex({ strikes: [] })} spot={22700} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByTestId("nifty-gex-profile-chart")).toBeInTheDocument();
    expect(screen.getByText("No per-strike GEX profile")).toBeInTheDocument();
  });

  test("stat row is container-driven, never a fixed four-column template", () => {
    render(() => <NiftyGexProfile gex={gex()} spot={22700} />, { wrapper: TestWrapper });

    const row = screen.getByTestId("nifty-gex-profile-stat-row");
    expect(row.className).toContain("grid-cols-[repeat(auto-fit,minmax(150px,1fr))]");
    expect(row.className).not.toContain("grid-cols-[repeat(4,minmax(0,1fr))]");
    expect(row.className).toContain("min-w-0");

    // All four cards survive with readable chrome: min-w-0, a titled label and
    // an unwrapped (tabular) value.
    for (const id of ["net", "zero", "support", "resist"]) {
      const card = screen.getByTestId(`nifty-gex-profile-${id}`);
      expect(card.className).toContain("min-w-0");
      expect(card.querySelector("span[title]")).not.toBeNull();
      expect(card.querySelector(".tabular-nums")).not.toBeNull();
    }
  });
});

describe("GEX analytics-window overflow", () => {
  const renderFull = () => render(() => <NiftyGexProfile gex={gex()} spot={22700} />, {
    wrapper: TestWrapper,
  });

  test("the whole stack lives in a 281px scroll region — chart and all four stats survive", () => {
    renderFull();

    const region = screen.getByTestId("nifty-gex-scroll-region");
    expect(region.style.maxHeight).toBe("281px");
    expect(region.getAttribute("role")).toBe("region");
    for (const id of ["net", "zero", "support", "resist", "chart"]) {
      expect(region.querySelector(`[data-testid="nifty-gex-profile-${id}"]`)).not.toBeNull();
    }
  });

  test("a labelled cue appears beside the scrollport only while more content is below", () => {
    renderFull();

    const region = screen.getByTestId("nifty-gex-scroll-region") as HTMLElement;
    expect(screen.queryByTestId("nifty-gex-scroll-cue")).toBeNull();

    Object.defineProperty(region, "scrollHeight", { configurable: true, value: 420 });
    Object.defineProperty(region, "clientHeight", { configurable: true, value: 200 });
    Object.defineProperty(region, "scrollTop", { configurable: true, value: 0, writable: true });
    fireEvent.scroll(region);

    const cue = screen.getByTestId("nifty-gex-scroll-cue");
    expect(cue).toHaveTextContent("Scroll for more ↓");
    expect(cue.getAttribute("title")).toContain("Scroll");
    expect(screen.getByTestId("nifty-gex-scroll-fade").getAttribute("aria-hidden")).toBe("true");
    // The cue is a sibling of the scrollport, never a child covering its values.
    expect(region.querySelector('[data-testid="nifty-gex-scroll-cue"]')).toBeNull();
    // Space is reserved at the end of the scroll content so the last stat/caption
    // can never sit underneath the cue.
    expect(region.style.paddingBottom).toBe("16px");

    region.scrollTop = 220;
    fireEvent.scroll(region);
    expect(screen.queryByTestId("nifty-gex-scroll-cue")).toBeNull();
  });
});

describe("GEX copy has one numeric owner and one glyph", () => {
  test("flip and spot are printed once: stat row owns the numbers, regime owns the verdict", () => {
    render(() => <NiftyGexProfile gex={gex()} spot={22700} />, { wrapper: TestWrapper });

    const row = screen.getByTestId("nifty-gex-profile-stat-row");
    expect(row).toHaveTextContent("22,650");
    expect(row.textContent).not.toMatch(/Spot\s/);

    const panel = screen.getByTestId("nifty-gex-profile-panel");
    expect(panel.textContent).not.toMatch(/pts (above|below) flip/);

    const regime = screen.getByTestId("nifty-gex-profile-regime");
    expect(regime).toHaveTextContent("LONG GAMMA");
    expect(regime.textContent).not.toMatch(/Spot|flip/);
    expect(screen.getByTestId("nifty-gex-profile-verdict")).toHaveTextContent("magnet");
  });

  test("the SHORT GAMMA verdict stays visible and the long reading moves to a tooltip", () => {
    const short = gex({
      strikes: [
        { strike: 22600, callGex: 0, putGex: -6, netGex: -6 },
        { strike: 22700, callGex: 0, putGex: -4, netGex: -4 },
        { strike: 22800, callGex: 0, putGex: 20, netGex: 20 },
      ],
      zeroCross: null,
      regime: "short",
    });
    render(() => <NiftyGexProfile gex={short} spot={22700} />, { wrapper: TestWrapper });

    const regime = screen.getByTestId("nifty-gex-profile-regime");
    expect(regime).toHaveTextContent("SHORT GAMMA");
    const verdict = screen.getByTestId("nifty-gex-profile-verdict");
    expect(verdict).toHaveTextContent("fuel");
    expect(verdict.getAttribute("title")).toContain("Dealers are short gamma");
    expect(regime.textContent).not.toContain("Dealers are short gamma");
  });

  test("γ is never uppercased into Γ by label chrome", () => {
    render(() => <NiftyGexProfile gex={gex()} spot={22700} />, { wrapper: TestWrapper });

    for (const id of ["net", "support", "resist"]) {
      const label = screen.getByTestId(`nifty-gex-profile-${id}`).querySelector("span[title]") as HTMLElement;
      expect(label.textContent).toContain("γ");
      expect(label.className).not.toContain("uppercase");
    }

    const dir = resolve(process.cwd(), "src/pages/report");
    for (const file of [
      "NiftyGexProfile.tsx",
      "NiftyGexProfile.rows.tsx",
      "NiftyGexProfile.legend.tsx",
    ]) {
      expect(readFileSync(resolve(dir, file), "utf8"), file).not.toContain("Γ");
    }
  });
});

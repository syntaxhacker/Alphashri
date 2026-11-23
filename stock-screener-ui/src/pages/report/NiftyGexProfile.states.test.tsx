// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { render, screen } from "@solidjs/testing-library";
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
});

// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, afterEach } from "vitest";
import { createElement as h } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import {
  attributeNiftyPnl,
  formatPnlSigned,
  type NiftyPnlGreeks,
  type NiftyPnlPosition,
} from "./niftyPnlAttribution";
import { NiftyPnlAttribution } from "./NiftyPnlAttribution";

afterEach(cleanup);

function TestWrapper({ children }: { children: React.ReactNode }) {
  return h(UIProvider, null, children);
}

const LONG_CE: NiftyPnlPosition = {
  opt: "CE",
  strike: 25000,
  direction: "long",
  entry_premium: 100,
  qty: 50,
  entry_spot: 25000,
  entry_iv: 12,
  elapsed_days: 0.5,
};

const GREEKS: NiftyPnlGreeks[] = [
  { opt: "CE", strike: 25000, ltp: 130, delta: 0.5, theta: -2, vega: 5, iv: 14 },
];

describe("attributeNiftyPnl", () => {
  test("long CE: spot rise books a positive delta part", () => {
    const { legs } = attributeNiftyPnl([LONG_CE], GREEKS, 25100);
    // (25100 − 25000) × 0.5 × 50
    expect(legs[0].delta).toBe(2500);
  });

  test("short flips every signed part", () => {
    const short: NiftyPnlPosition = { ...LONG_CE, direction: "short" };
    const { legs } = attributeNiftyPnl([short], GREEKS, 25100);
    expect(legs[0].delta).toBe(-2500);
    // IV rose 12 → 14: long gains, short loses
    expect(legs[0].vega).toBe(-500);
  });

  test("vega follows the IV move, theta accrues decay", () => {
    const { legs } = attributeNiftyPnl([LONG_CE], GREEKS, 25000);
    // Δspot 0 → delta 0; (14 − 12) × 5 × 50
    expect(legs[0].delta).toBe(0);
    expect(legs[0].vega).toBe(500);
    // −2 × 0.5 × 50
    expect(legs[0].theta).toBe(-50);
  });

  test("short theta is decay collected (positive)", () => {
    const short: NiftyPnlPosition = { ...LONG_CE, direction: "short" };
    const { legs } = attributeNiftyPnl([short], GREEKS, 25000);
    expect(legs[0].theta).toBe(50);
  });

  test("vega is 0 when the entry IV is unknown", () => {
    const noIv: NiftyPnlPosition = { ...LONG_CE, entry_iv: null };
    const { legs } = attributeNiftyPnl([noIv], GREEKS, 25000);
    expect(legs[0].vega).toBe(0);
  });

  test("residual is total minus the three explained parts", () => {
    const { legs } = attributeNiftyPnl([LONG_CE], GREEKS, 25100);
    // total = (130 − 100) × 50 = 1500; parts = 2500 + 500 − 50
    expect(legs[0].total).toBe(1500);
    expect(legs[0].residual).toBe(1500 - (2500 + 500 - 50));
  });

  test("missing greeks fall back to zeros with the flag set", () => {
    const { legs } = attributeNiftyPnl([LONG_CE], [], 25100);
    expect(legs[0].missingGreeks).toBe(true);
    expect(legs[0].current).toBeNull();
    expect([legs[0].delta, legs[0].vega, legs[0].theta, legs[0].residual, legs[0].total].every((v) => v === 0)).toBe(true);
  });

  test("partial greeks still price the total; residual absorbs the unknown", () => {
    const thin: NiftyPnlGreeks[] = [{ opt: "CE", strike: 25000, ltp: 130 }];
    const { legs } = attributeNiftyPnl([LONG_CE], thin, 25100);
    expect(legs[0].missingGreeks).toBe(false);
    expect(legs[0].total).toBe(1500);
    expect(legs[0].delta).toBe(0);
    expect(legs[0].residual).toBe(1500);
  });

  test("panel total sums every leg", () => {
    const pe: NiftyPnlPosition = {
      opt: "PE", strike: 24900, direction: "long",
      entry_premium: 80, qty: 50, entry_spot: 25000, elapsed_days: 0,
    };
    const g: NiftyPnlGreeks[] = [
      ...GREEKS,
      { opt: "PE", strike: 24900, ltp: 70, delta: -0.4, theta: -1, vega: 4, iv: 12 },
    ];
    const out = attributeNiftyPnl([LONG_CE, pe], g, 25100);
    expect(out.legs).toHaveLength(2);
    expect(out.total).toBe(out.legs[0].total + out.legs[1].total);
  });
});

describe("formatPnlSigned", () => {
  test("signs, zeroes and dashes", () => {
    expect(formatPnlSigned(2500)).toBe("+2,500");
    expect(formatPnlSigned(-120)).toBe("−120");
    expect(formatPnlSigned(0)).toBe("0");
    expect(formatPnlSigned(null)).toBe("—");
  });
});

describe("NiftyPnlAttribution render", () => {
  test("stacked bars per leg with legend and signed total", () => {
    render(
      h(
        TestWrapper,
        null,
        h(NiftyPnlAttribution, { positions: [LONG_CE], greeks: GREEKS, spot: 25100 }),
      ),
    );
    expect(screen.getByTestId("nifty-pnl-bar-25000-CE-long")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-pnl-seg-25000-CE-long-delta")).toHaveAttribute("data-sign", "gain");
    expect(screen.getByTestId("nifty-pnl-seg-25000-CE-long-theta")).toHaveAttribute("data-sign", "loss");
    for (const k of ["delta", "vega", "theta", "residual"]) {
      expect(screen.getByTestId(`nifty-pnl-legend-${k}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("nifty-pnl-total")).toHaveTextContent("+1,500");
    expect(screen.getByTestId("nifty-pnl-total-25000-CE-long")).toHaveTextContent("+1,500");
  });

  test("no positions renders the muted empty state", () => {
    render(
      h(
        TestWrapper,
        null,
        h(NiftyPnlAttribution, { positions: [], greeks: GREEKS, spot: 25100 }),
      ),
    );
    expect(screen.getByTestId("nifty-pnl-empty")).toHaveTextContent("No open positions");
  });

  test("no greeks renders the muted empty state", () => {
    render(
      h(
        TestWrapper,
        null,
        h(NiftyPnlAttribution, { positions: [LONG_CE], greeks: [], spot: 25100 }),
      ),
    );
    expect(screen.getByTestId("nifty-pnl-empty")).toHaveTextContent("No open positions");
  });
});

// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";
import {
  NiftyDeltaPositioning,
  POSITIONING_DASH,
  fmtCr,
  positioningAccent,
  positioningSplitLabel,
  positioningVerdictLabel,
  signedPositioningAccent,
} from "./NiftyDeltaPositioning";
import type {
  NiftyPositioningBlock,
  NiftyPositioningVerdict,
} from "@/types/niftyReport";

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: TestWrapper });
}

function fullBlock(
  overrides?: Partial<NiftyPositioningBlock>,
): NiftyPositioningBlock {
  return {
    verdict: "bullish",
    state: 53185,
    flow: -1200,
    initiated: 42371,
    bullCr: 53185,
    bearCr: 10814,
    splitPct: 83.1,
    ceDoi: 1500,
    peDoi: -800,
    lotSize: 75,
    strikes: [
      {
        strike: 25700,
        ce: { class: "CE", doi: 1200, initiated: 900 },
        pe: { class: "PE", doi: -800, initiated: -600 },
        netInitiated: 300,
      },
      {
        strike: 25800,
        ce: { class: "CE", doi: -400, initiated: -250 },
        pe: { class: "PE", doi: 650, initiated: 500 },
        netInitiated: 250,
      },
    ],
    ...overrides,
  };
}

afterEach(cleanup);

describe("fmtCr", () => {
  test("signs and groups positives with Indian grouping", () => {
    expect(fmtCr(53185)).toBe("+53,185");
    expect(fmtCr(12345678)).toBe("+1,23,45,678");
    expect(fmtCr(7)).toBe("+7");
  });

  test("signs negatives and keeps zero unsigned", () => {
    expect(fmtCr(-1200)).toBe("-1,200");
    expect(fmtCr(-12345678)).toBe("-1,23,45,678");
    expect(fmtCr(0)).toBe("0");
  });

  test("rounds to 0 decimals", () => {
    expect(fmtCr(1234.6)).toBe("+1,235");
    // rounds to zero -> unsigned zero, never "-0"
    expect(fmtCr(-0.4)).toBe("0");
  });

  test("null / undefined / non-finite render a dash", () => {
    expect(fmtCr(null)).toBe(POSITIONING_DASH);
    expect(fmtCr(undefined)).toBe(POSITIONING_DASH);
    expect(fmtCr(Number.NaN)).toBe(POSITIONING_DASH);
    expect(fmtCr(Number.POSITIVE_INFINITY)).toBe(POSITIONING_DASH);
  });
});

describe("positioningAccent", () => {
  test("bullish green, bearish red, balanced/absent muted", () => {
    expect(positioningAccent("bullish")).toBe(palette.POSITIVE);
    expect(positioningAccent("bearish")).toBe(palette.NEGATIVE);
    expect(positioningAccent("balanced")).toBe(palette.TEXT_MUTED);
    expect(positioningAccent(null)).toBe(palette.TEXT_MUTED);
    expect(positioningAccent(undefined)).toBe(palette.TEXT_MUTED);
  });
});

describe("verdict + signed tone + split helpers", () => {
  test("verdict label uppercases known values and dashes the unknown", () => {
    expect(positioningVerdictLabel("bullish")).toBe("BULLISH");
    expect(positioningVerdictLabel("bearish")).toBe("BEARISH");
    expect(positioningVerdictLabel("balanced")).toBe("BALANCED");
    expect(positioningVerdictLabel(null)).toBe(POSITIONING_DASH);
    expect(positioningVerdictLabel("sideways" as NiftyPositioningVerdict)).toBe(
      POSITIONING_DASH,
    );
  });

  test("signed tone: positive green, negative red, zero/absent muted", () => {
    expect(signedPositioningAccent(10)).toBe(palette.POSITIVE);
    expect(signedPositioningAccent(-10)).toBe(palette.NEGATIVE);
    expect(signedPositioningAccent(0)).toBe(palette.TEXT_MUTED);
    expect(signedPositioningAccent(null)).toBe(palette.TEXT_MUTED);
  });

  test("split uses the dominant magnitude and rounded share", () => {
    expect(positioningSplitLabel(53185, 10814, 83.1)).toBe("53,185 Cr · 83%");
    // share < 50 flips to the bear side
    expect(positioningSplitLabel(10000, 40000, 20)).toBe("40,000 Cr · 20%");
    // share absent -> larger magnitude wins
    expect(positioningSplitLabel(10000, 40000, null)).toBe("40,000 Cr · —");
    // everything absent -> single dash
    expect(positioningSplitLabel(null, null, null)).toBe(POSITIONING_DASH);
  });
});

describe("NiftyDeltaPositioning render", () => {
  test("full block: verdict, signed summary rows with formula tooltips", () => {
    r(<NiftyDeltaPositioning positioning={fullBlock()} />);
    const panel = screen.getByTestId("nifty-positioning-panel");
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveTextContent("Delta positioning");

    expect(screen.getByTestId("nifty-positioning-verdict")).toHaveTextContent(
      "BULLISH",
    );

    const state = screen.getByTestId("nifty-positioning-state");
    expect(state).toHaveTextContent("State");
    expect(state).toHaveTextContent("+53,185");
    expect(state).toHaveAttribute("title", "State = Σ OI×|delta|, calls + / puts −");

    const flow = screen.getByTestId("nifty-positioning-flow");
    expect(flow).toHaveTextContent("-1,200");
    expect(flow).toHaveAttribute("title", "Flow = Σ ΔOI×|delta|, calls + / puts −");

    const initiated = screen.getByTestId("nifty-positioning-initiated");
    expect(initiated).toHaveTextContent("+42,371");
    expect(initiated).toHaveAttribute(
      "title",
      "Initiated = ΔOI×|delta| signed by class (+ = bullish)",
    );

    expect(screen.getByTestId("nifty-positioning-split")).toHaveTextContent(
      "53,185 Cr · 83%",
    );
  });

  test("full block: one row per strike with each numeric cell formatted", () => {
    r(<NiftyDeltaPositioning positioning={fullBlock()} />);
    const table = screen.getByTestId("nifty-positioning-table");
    const rows = within(table).getAllByTestId(/^nifty-positioning-row-/);
    expect(rows).toHaveLength(2);

    const first = within(table).getByTestId("nifty-positioning-row-25700-0");
    expect(first).toHaveTextContent("25,700");
    expect(first).toHaveTextContent("+1,200");
    expect(first).toHaveTextContent("+900");
    expect(first).toHaveTextContent("-800");
    expect(first).toHaveTextContent("-600");
    expect(first).toHaveTextContent("+300");
    expect(first).not.toHaveTextContent("NaN");

    const second = within(table).getByTestId("nifty-positioning-row-25800-1");
    expect(second).toHaveTextContent("25,800");
    expect(second).toHaveTextContent("-400");
    expect(second).toHaveTextContent("+650");
    expect(second).toHaveTextContent("+250");
  });

  test("undefined block: dashes everywhere, empty table, no crash", () => {
    r(<NiftyDeltaPositioning positioning={undefined} />);
    const panel = screen.getByTestId("nifty-positioning-panel");
    expect(panel).toBeInTheDocument();
    expect(screen.getByTestId("nifty-positioning-verdict")).toHaveTextContent(
      POSITIONING_DASH,
    );
    expect(screen.getByTestId("nifty-positioning-state")).toHaveTextContent(
      POSITIONING_DASH,
    );
    expect(screen.getByTestId("nifty-positioning-flow")).toHaveTextContent(
      POSITIONING_DASH,
    );
    expect(screen.getByTestId("nifty-positioning-initiated")).toHaveTextContent(
      POSITIONING_DASH,
    );
    expect(screen.getByTestId("nifty-positioning-split")).toHaveTextContent(
      POSITIONING_DASH,
    );
    expect(screen.getByText("No strike breakdown")).toBeInTheDocument();
    expect(
      screen.queryAllByTestId(/^nifty-positioning-row-/),
    ).toHaveLength(0);
  });

  test("partial block: absent strikes still renders the panel safely", () => {
    r(
      <NiftyDeltaPositioning
        positioning={fullBlock({ strikes: undefined as never, verdict: "balanced" })}
      />,
    );
    expect(screen.getByTestId("nifty-positioning-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-positioning-verdict")).toHaveTextContent(
      "BALANCED",
    );
    expect(screen.getByText("No strike breakdown")).toBeInTheDocument();
  });

  test("empty strikes array renders the table empty state", () => {
    r(<NiftyDeltaPositioning positioning={fullBlock({ strikes: [] })} />);
    expect(screen.getByTestId("nifty-positioning-table")).toBeInTheDocument();
    expect(screen.getByText("No strike breakdown")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^nifty-positioning-row-/)).toHaveLength(0);
  });
});

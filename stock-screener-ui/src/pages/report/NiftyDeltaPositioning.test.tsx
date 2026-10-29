// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";
import {
  NiftyDeltaPositioning,
  POSITIONING_DASH,
  POSITIONING_WINDOW_PTS,
  flipDistanceLabel,
  fmtCr,
  fmtFlipStrike,
  nearestPositioningStrike,
  positioningAccent,
  positioningSplit,
  positioningSplitLabel,
  positioningVerdictLabel,
  signedPositioningAccent,
} from "./NiftyDeltaPositioning";
import { buildDeltaProfile } from "./DeltaProfileChart";
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
    deltaFlip: 25750,
    strikes: [
      {
        strike: 25700,
        ce: { class: "CE", doi: 1200, initiated: 900 },
        pe: { class: "PE", doi: -800, initiated: -600 },
        netInitiated: 300,
        netState: -1200,
      },
      {
        strike: 25800,
        ce: { class: "CE", doi: -400, initiated: -250 },
        pe: { class: "PE", doi: 650, initiated: 500 },
        netInitiated: 250,
        netState: 1800,
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

  test("split uses the dominant magnitude and its share of gross initiated", () => {
    expect(positioningSplitLabel(53185, 10814, 83.1)).toBe(
      "53,185 Cr · bullish 83.1%",
    );
    // share < 50 is not the dominant share: derive it from the two sides.
    expect(positioningSplitLabel(10000, 40000, 20)).toBe("40,000 Cr · bearish 80%");
    // share absent -> the two sides still derive the dominant share
    expect(positioningSplitLabel(10000, 40000, null)).toBe("40,000 Cr · bearish 80%");
    // everything absent -> single dash
    expect(positioningSplitLabel(null, null, null)).toBe(POSITIONING_DASH);
  });

  test("the 14:59 bear-led tape reads bearish, never 96% bullish", () => {
    // Live payload: bull 2,922 Cr / bear 62,631 Cr with split_pct = 96.
    expect(positioningSplitLabel(2922, 62631, 96)).toBe(
      "62,631 Cr · bearish 96%",
    );
    const split = positioningSplit(2922, 62631, 96);
    expect(split.bullShare).toBe(4);
    expect(split.bearShare).toBe(96);
    expect(split.bullShare + split.bearShare).toBe(100);
    expect(split.dominant).toBe("bear");
    expect(split.magnitude).toBe(62631);
  });

  test("shares are exact complements, so rounding can never show 101%", () => {
    const split = positioningSplit(5100, 4900, null);
    expect(split.bullShare + split.bearShare).toBe(100);
    expect(split.bullShare).toBe(51);
    expect(split.bearShare).toBe(49);
  });
});

describe("delta flip helpers", () => {
  test("fmtFlipStrike groups integers and dashes absent values", () => {
    expect(fmtFlipStrike(25750)).toBe("25,750");
    expect(fmtFlipStrike(0)).toBe("0");
    expect(fmtFlipStrike(null)).toBe(POSITIONING_DASH);
    expect(fmtFlipStrike(Number.NaN)).toBe(POSITIONING_DASH);
  });

  test("flipDistanceLabel signs the gap, handles at-spot and absent", () => {
    expect(flipDistanceLabel(25800, 25750)).toBe("-50 pts");
    expect(flipDistanceLabel(25700, 25750)).toBe("+50 pts");
    expect(flipDistanceLabel(25750, 25750)).toBe("at spot");
    expect(flipDistanceLabel(null, 25750)).toBe(POSITIONING_DASH);
    expect(flipDistanceLabel(25750, null)).toBe(POSITIONING_DASH);
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
      "53,185 Cr · bullish 83.1%",
    );

    const flip = screen.getByTestId("nifty-positioning-flip");
    expect(flip).toHaveTextContent("Δ pivot");
    expect(flip).toHaveTextContent("25,750");
  });

  test("delta flip stat carries the signed distance from spot", () => {
    r(<NiftyDeltaPositioning positioning={fullBlock()} spot={25800} />);
    const flip = screen.getByTestId("nifty-positioning-flip");
    expect(flip).toHaveTextContent("25,750");
    expect(flip).toHaveTextContent("-50 pts");
  });

  test("full block: draws the cumulative profile over the initiated flow", () => {
    r(<NiftyDeltaPositioning positioning={fullBlock()} spot={25750} />);
    const profile = screen.getByTestId("nifty-positioning-profile");
    expect(profile).toBeInTheDocument();
    const svg = profile.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute(
      "aria-label",
      "Cumulative delta exposure and today's initiated delta by strike",
    );
    expect(
      screen.getByTestId("nifty-positioning-profile-readout"),
    ).toHaveTextContent("25,700–25,800");
    expect(profile).toHaveTextContent("Cumulative δ");
    expect(profile).toHaveTextContent("Flow +");
    expect(profile).toHaveTextContent("Δ pivot");
    expect(
      screen.getByTestId("nifty-positioning-profile-marker-spot"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("nifty-positioning-profile-marker-flip"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-positioning-table")).not.toBeInTheDocument();
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
    expect(screen.getByTestId("nifty-positioning-flip")).toHaveTextContent(
      POSITIONING_DASH,
    );
    expect(screen.getByText("No strike breakdown")).toBeInTheDocument();
    expect(
      screen.queryByTestId("nifty-positioning-profile-readout"),
    ).not.toBeInTheDocument();
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

  test("empty strikes array renders the chart empty state", () => {
    r(<NiftyDeltaPositioning positioning={fullBlock({ strikes: [] })} />);
    expect(screen.getByTestId("nifty-positioning-profile")).toBeInTheDocument();
    expect(screen.getByText("No strike breakdown")).toBeInTheDocument();
    expect(
      screen.queryByTestId("nifty-positioning-profile-readout"),
    ).not.toBeInTheDocument();
  });
});

describe("delta profile", () => {
  const strikeRow = (strike: number, netState: number, netInitiated = 0) => ({
    strike,
    ce: { class: "CE", doi: 10, initiated: 10 },
    pe: { class: "PE", doi: -10, initiated: -10 },
    netInitiated,
    netState,
  });

  test("keeps the ±750 band around spot and drops far strikes", () => {
    const rows = [23000, 23100, 23300, 25000].map((s) => strikeRow(s, 0));
    const points = buildDeltaProfile(rows, 23_100);
    expect(points.map((p) => p.strike)).toEqual([23000, 23100, 23300]);
    expect(POSITIONING_WINDOW_PTS).toBe(750);
  });

  test("accumulates across the whole chain before windowing", () => {
    // 20,000 sits outside the window and must still feed the running total.
    const rows = [
      strikeRow(20000, 1000),
      strikeRow(23000, -500),
      strikeRow(23100, -300),
      strikeRow(23300, -400),
      strikeRow(25000, 900),
    ];
    const points = buildDeltaProfile(rows, 23_100);
    expect(points.map((p) => p.strike)).toEqual([23000, 23100, 23300]);
    expect(points.map((p) => p.cumulative)).toEqual([500, 200, -200]);
    // The zero crossing lands between 23,100 and 23,300 — the pivot.
    expect(points[1].cumulative).toBeGreaterThan(0);
    expect(points[2].cumulative).toBeLessThan(0);
  });

  test("no spot (old snapshot) keeps every row", () => {
    const rows = [23000, 25000].map((s) => strikeRow(s, 1));
    expect(buildDeltaProfile(rows, null)).toHaveLength(2);
    expect(buildDeltaProfile(rows, undefined)).toHaveLength(2);
    expect(buildDeltaProfile(rows, 0)).toHaveLength(2);
  });

  test("an empty window falls back to the full list", () => {
    const rows = [20000].map((s) => strikeRow(s, 1));
    expect(buildDeltaProfile(rows, 23_100)).toHaveLength(1);
  });

  test("payloads without per-strike net_state return no profile", () => {
    const rows = [
      {
        strike: 23000,
        ce: { class: "CE", doi: 10, initiated: 10 },
        pe: { class: "PE", doi: -10, initiated: -10 },
        netInitiated: 0,
      },
    ];
    expect(buildDeltaProfile(rows, 23_000)).toEqual([]);
  });

  test("a flip outside the band omits the flip marker", () => {
    // A whole-chain pivot can sit far outside the ±750 window; pinning the
    // marker to the nearest edge strike would claim a level that is not there.
    r(
      <NiftyDeltaPositioning
        positioning={fullBlock({ deltaFlip: 20000 })}
        spot={25750}
      />,
    );
    expect(
      screen.getByTestId("nifty-positioning-profile-marker-spot"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("nifty-positioning-profile-marker-flip"),
    ).not.toBeInTheDocument();
    // The headline chip still reports the true pivot.
    expect(screen.getByTestId("nifty-positioning-flip")).toHaveTextContent(
      "20,000",
    );
  });

  test("ATM rounds to the 50-point strike step", () => {
    expect(nearestPositioningStrike(23_082.95)).toBe(23_100);
    expect(nearestPositioningStrike(23_074)).toBe(23_050);
    expect(nearestPositioningStrike(null)).toBeNull();
  });

  test("render windows the profile and labels the ATM strike", () => {
    const block = fullBlock({
      strikes: [23000, 23100, 25000].map((s) => strikeRow(s, 1)),
    });
    r(<NiftyDeltaPositioning positioning={block} spot={23_100} />);
    expect(
      screen.getByTestId("nifty-positioning-profile-readout"),
    ).toHaveTextContent("23,000–23,100");
    expect(screen.getByTestId("nifty-positioning-window")).toHaveTextContent(
      "Profile ±750 pts · ATM 23,100",
    );
  });
});

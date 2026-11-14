// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { createSignal } from "solid-js";
import { cleanup, render, screen, within } from "@solidjs/testing-library";

import type { NiftyReport, NiftySensex, NiftyWall } from "@/types/niftyReport";
import { LevelsInPlay, LevelsInPlayContent } from "./LevelsInPlay";

const OHLC = { open: 24_600, high: 24_720, low: 24_540, close: 24_650 };

function makeReport(over: Partial<NiftyReport> = {}): NiftyReport {
  return {
    mode: "live",
    date: "2026-11-06",
    expiry: "2026-11-06",
    spot: 24_650,
    ohlc: OHLC,
    pcrOi: 1.05,
    pcrVol: 1.1,
    maxPain: 24_600,
    walls: { calls: [], puts: [] },
    strikes: [],
    timeline: [],
    ...over,
  };
}

function makeSensex(over: Partial<NiftySensex> = {}): NiftySensex {
  return {
    symbol: "SENSEX",
    spot: 79_500,
    expiry: "2026-11-06",
    pcrOi: 1.02,
    pcrVol: 1.08,
    maxPain: 79_400,
    walls: { calls: [], puts: [] },
    ohlc: { open: 79_300, high: 79_650, low: 79_200, close: 79_500 },
    ...over,
  };
}

const wall = (strike: number, oi: number): NiftyWall => ({ strike, oi });

afterEach(cleanup);

describe("LevelsInPlay", () => {
  it("picks the nearest significant call wall, not a nearer tiny-OI strike", () => {
    render(() => (
      <LevelsInPlay
        report={makeReport({
          spot: 24_650,
          walls: {
            calls: [wall(24_660, 100_000), wall(24_700, 2_000_000)],
            puts: [],
          },
        })}
        sensex={null}
      />
    ));

    const calls = screen.getByTestId("levels-ce-NIFTY");
    expect(calls).toHaveTextContent("24,700");
    expect(calls).not.toHaveTextContent("24,660");
  });

  it("filters put strikes to those below spot (79,000, not 79,800)", () => {
    render(() => (
      <LevelsInPlay
        report={null}
        sensex={makeSensex({
          spot: 79_500,
          walls: {
            calls: [],
            puts: [wall(79_800, 5_000_000), wall(79_000, 4_000_000)],
          },
        })}
      />
    ));

    const puts = screen.getByTestId("levels-pe-SENSEX");
    expect(puts).toHaveTextContent("79,000");
    expect(puts).not.toHaveTextContent("79,800");
  });

  it("renders DUAL RESISTANCE with both nearest calls when indices disagree on nothing", () => {
    render(() => (
      <LevelsInPlay
        report={makeReport({
          spot: 24_650,
          walls: { calls: [wall(24_700, 2_000_000)], puts: [] },
        })}
        sensex={makeSensex({
          spot: 79_500,
          walls: { calls: [wall(79_600, 3_000_000)], puts: [] },
        })}
      />
    ));

    expect(screen.getByTestId("levels-badge")).toHaveTextContent("DUAL RESISTANCE");
    expect(screen.getByTestId("levels-ce-NIFTY")).toHaveTextContent("24,700");
    expect(screen.getByTestId("levels-ce-SENSEX")).toHaveTextContent("79,600");
  });

  it("formats distance as percent plus points and keeps the row dense", () => {
    render(() => (
      <LevelsInPlay
        report={makeReport({
          spot: 24_650,
          walls: { calls: [wall(24_700, 2_000_000)], puts: [] },
        })}
        sensex={null}
      />
    ));

    const dist = screen.getByTestId("levels-dist-NIFTY-CE");
    expect(dist).toHaveTextContent("%");
    expect(dist).toHaveTextContent(/\d+p$/);
    expect(dist).toHaveTextContent("+0.20% +50p");

    const row = screen.getByTestId("levels-row-NIFTY");
    expect(within(row).getByTestId("levels-ce-NIFTY")).toBeInTheDocument();
    expect(within(row).getByTestId("levels-pe-NIFTY")).toBeInTheDocument();
    expect(row).toHaveTextContent("MP 24,600");
  });

  it("reserves room for the widest label+spot and caps the distance chip at 14px", () => {
    render(() => (
      <LevelsInPlayContent
        report={makeReport({
          spot: 24_878,
          walls: { calls: [wall(24_900, 2_000_000)], puts: [] },
        })}
        sensex={makeSensex({ spot: 80_636 })}
      />
    ));

    // happy-dom can't measure overlap; assert the style contract instead:
    // label group never shrinks below the widest "SENSEX 80,636" run.
    expect(screen.getByTestId("levels-label-NIFTY")).toHaveStyle({ minWidth: "84px" });
    expect(screen.getByTestId("levels-label-SENSEX")).toHaveStyle({ minWidth: "84px" });

    const chip = screen.getByTestId("levels-dist-NIFTY-CE");
    expect(chip).toHaveStyle({ height: "14px", display: "inline-flex", lineHeight: "1" });
  });

  it("updates the nearest wall when the report prop signal changes", () => {
    const [reportSig, setReportSig] = createSignal<NiftyReport | null>(
      makeReport({ spot: 24_650, walls: { calls: [wall(24_700, 2_000_000)], puts: [] } }),
    );
    render(() => <LevelsInPlay report={reportSig()} sensex={null} />);

    expect(screen.getByTestId("levels-ce-NIFTY")).toHaveTextContent("24,700");

    setReportSig(makeReport({ spot: 24_650, walls: { calls: [wall(24_800, 3_000_000)], puts: [] } }));

    expect(screen.getByTestId("levels-ce-NIFTY")).toHaveTextContent("24,800");
    expect(screen.getByTestId("levels-ce-NIFTY")).not.toHaveTextContent("24,700");
  });
});

describe("LevelsInPlayContent", () => {
  it("renders CE and PE adjacent in one dense row with no wrapper badge", () => {
    render(() => (
      <LevelsInPlayContent
        report={makeReport({
          spot: 24_650,
          walls: { calls: [wall(24_700, 2_000_000)], puts: [wall(24_600, 1_500_000)] },
        })}
        sensex={null}
      />
    ));

    expect(screen.queryByTestId("levels-badge")).toBeNull();
    const row = screen.getByTestId("levels-row-NIFTY");
    expect(within(row).getByTestId("levels-ce-NIFTY")).toHaveTextContent("24,700");
    expect(within(row).getByTestId("levels-pe-NIFTY")).toHaveTextContent("24,600");
    expect(row).toHaveTextContent("MP 24,600");
  });

  it("renders the SENSEX row when only sensex is given", () => {
    render(() => <LevelsInPlayContent report={null} sensex={makeSensex()} />);

    expect(screen.getByTestId("levels-row-SENSEX")).toBeInTheDocument();
    expect(screen.queryByTestId("levels-row-NIFTY")).toBeNull();
  });

  it("returns null when neither report nor sensex is given", () => {
    render(() => <LevelsInPlayContent report={null} sensex={null} />);
    expect(screen.queryByTestId("levels-row-NIFTY")).toBeNull();
    expect(screen.queryByTestId("levels-row-SENSEX")).toBeNull();
  });
});

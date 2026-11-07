// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, afterEach } from "vitest";
import { createElement as h } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import {
  buildVolumeProfile,
  formatProfileCompact,
  type NiftyVolumeTapeRow,
} from "./niftyVolumeProfile";
import { NiftyVolumeProfile } from "./NiftyVolumeProfile";

afterEach(cleanup);

function TestWrapper({ children }: { children: React.ReactNode }) {
  return h(UIProvider, null, children);
}

// chain[strike] = [ce_ltp, pe_ltp, ce_oi, pe_oi, ce_vol, pe_vol]
function row(
  t: string,
  spot: number,
  chain: Record<string, [number, number, number, number, number, number]>,
): NiftyVolumeTapeRow {
  return { t, spot, atm_strike: 25000, chain };
}

const ROWS = [
  row("09:15", 25010, {
    "24900": [10, 12, 1000, 900, 100, 80],
    "25000": [20, 22, 2000, 1900, 300, 250],
    "25100": [8, 30, 500, 2500, 50, 400],
  }),
  row("09:16", 25040, {
    "24900": [11, 11, 1100, 950, 150, 120],
    "25000": [25, 18, 2200, 2000, 500, 350],
    "25100": [9, 28, 550, 2600, 70, 600],
  }),
];

describe("buildVolumeProfile", () => {
  test("latest mode keeps the last row's cumulative values", () => {
    const p = buildVolumeProfile(ROWS);
    const s = p.points.find((x) => x.strike === 25000)!;
    expect(s.ceVol).toBe(500);
    expect(s.peVol).toBe(350);
    expect(s.ceOi).toBe(2200);
    expect(s.peOi).toBe(2000);
  });

  test("totals sum every plotted strike", () => {
    const p = buildVolumeProfile(ROWS);
    expect(p.totals.ceVol).toBe(150 + 500 + 70);
    expect(p.totals.peVol).toBe(120 + 350 + 600);
    expect(p.totals.ceOi).toBe(1100 + 2200 + 550);
  });

  test("ATM is the strike nearest the last spot", () => {
    // last spot 25040 → nearest is 25000
    expect(buildVolumeProfile(ROWS).atmStrike).toBe(25000);
  });

  test("top-volume strike carries the most CE+PE volume", () => {
    // 24900: 270 · 25000: 850 · 25100: 670
    expect(buildVolumeProfile(ROWS).topStrike).toBe(25000);
  });

  test("delta mode differences last minus first", () => {
    const p = buildVolumeProfile(ROWS, { mode: "delta" });
    const s = p.points.find((x) => x.strike === 25000)!;
    expect(s.ceVol).toBe(200);
    expect(s.peVol).toBe(100);
    // OI stays latest even in delta mode
    expect(s.ceOi).toBe(2200);
  });

  test("delta mode counts a single-observation strike in full", () => {
    const rows = [
      row("09:15", 25010, { "25000": [20, 22, 2000, 1900, 300, 250] }),
      row("09:16", 25040, {
        "25000": [25, 18, 2200, 2000, 500, 350],
        "25200": [5, 40, 100, 800, 90, 110],
      }),
    ];
    const p = buildVolumeProfile(rows, { mode: "delta" });
    expect(p.points.find((x) => x.strike === 25200)?.total).toBe(200);
  });

  test("widthPts windows far-OTM strikes out", () => {
    const p = buildVolumeProfile(ROWS, { widthPts: 50 });
    // |strike − 25040| ≤ 50 → only 25000
    expect(p.points.map((x) => x.strike)).toEqual([25000]);
  });

  test("empty / malformed input yields empty profile with null markers", () => {
    expect(buildVolumeProfile([])).toEqual({
      points: [],
      atmStrike: null,
      topStrike: null,
      totals: { ceVol: 0, peVol: 0, ceOi: 0, peOi: 0 },
    });
    expect(buildVolumeProfile(null).points).toEqual([]);
    expect(buildVolumeProfile([{ t: "x", spot: NaN, chain: null }]).topStrike).toBeNull();
    expect(buildVolumeProfile([{ t: "x", spot: 1, chain: { junk: [1, 2] } }]).points).toEqual([]);
  });
});

describe("formatProfileCompact", () => {
  test("compacts millions / thousands / dashes", () => {
    expect(formatProfileCompact(1_250_000)).toBe("1.25M");
    expect(formatProfileCompact(85000)).toBe("85.00K");
    expect(formatProfileCompact(null)).toBe("—");
  });
});

describe("NiftyVolumeProfile render", () => {
  test("bars per leg, ATM and top-volume markers", () => {
    render(
      h(TestWrapper, null, h(NiftyVolumeProfile, { rows: ROWS })),
    );
    expect(screen.getByTestId("nifty-volume-profile")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-volume-profile-ce-25000")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-volume-profile-pe-25100")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-volume-profile-atm")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-volume-profile-top")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-volume-profile-atm-label")).toHaveTextContent("25,000");
    expect(screen.getByTestId("nifty-volume-profile-ce-vol")).toHaveTextContent("720");
  });

  test("empty tape renders the muted empty state", () => {
    render(h(TestWrapper, null, h(NiftyVolumeProfile, { rows: [] })));
    expect(screen.getByTestId("nifty-volume-profile")).toHaveTextContent("No tape data");
  });
});

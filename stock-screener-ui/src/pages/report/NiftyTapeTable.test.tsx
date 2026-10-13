// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { UIProvider } from "@/ui";
import {
  NiftyTapeTable,
  buildTapeHead,
  formatTapeBaseline,
  formatTapeCompact,
  formatTapePct,
  formatTapePrice,
  formatTapeRatio,
  formatTapeSigned,
  formatTapeTime,
  getNiftyTapeColumns,
  getTapeBaseline,
  tapeDoiLabel,
} from "./NiftyTapeTable";
import type { NiftyTape, NiftyTapeRow } from "@/types/niftyReport";

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: TestWrapper });
}

function tapeRow(overrides?: Partial<NiftyTapeRow>): NiftyTapeRow {
  return {
    t: "09:15",
    spot: 25750.5,
    call_doi: 5530000,
    put_doi: -1200000,
    net: 170160000,
    net_pct: 2.35,
    call_tick: 850,
    put_tick: -400,
    pcr_vol: 0.95,
    pcr_oi: 1.12,
    pcr_doi: 0.08,
    spot_flip: 12,
    max_pain: 25700,
    flip: 25762,
    walls: { call: 25900, put: 25600 },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("tape formatters", () => {
  test("compact M/K with sign", () => {
    expect(formatTapeCompact(170160000)).toBe("+170.16M");
    expect(formatTapeCompact(5530000)).toBe("+5.53M");
    expect(formatTapeCompact(-1200000)).toBe("-1.20M");
    expect(formatTapeCompact(850)).toBe("+850");
    expect(formatTapeCompact(-400)).toBe("-400");
    expect(formatTapeCompact(0)).toBe("+0");
  });

  test("null/NaN render as em dash", () => {
    expect(formatTapeCompact(null)).toBe("—");
    expect(formatTapeCompact(undefined)).toBe("—");
    expect(formatTapeCompact(NaN)).toBe("—");
    expect(formatTapeSigned(null)).toBe("—");
    expect(formatTapePrice(undefined)).toBe("—");
    expect(formatTapePct(NaN)).toBe("—");
    expect(formatTapeRatio(null)).toBe("—");
  });

  test("price, signed, pct, ratio shapes", () => {
    expect(formatTapePrice(25750.5)).toBe("25,750.5");
    expect(formatTapeSigned(12)).toBe("+12");
    expect(formatTapeSigned(-8)).toBe("-8");
    expect(formatTapePct(2.35)).toBe("+2.35%");
    expect(formatTapePct(-1.2)).toBe("-1.20%");
    expect(formatTapeRatio(1.12)).toBe("1.12");
  });

  test("time strips ISO dates, passes HH:MM through", () => {
    expect(formatTapeTime("2026-10-12T09:15:00+05:30")).toBe("09:15:00");
    expect(formatTapeTime("09:15")).toBe("09:15");
  });
});

describe("getNiftyTapeColumns alignment meta", () => {
  test("every column declares explicit meta.align + fixed size", () => {
    const cols = getNiftyTapeColumns();
    expect(cols.length).toBe(12);
    for (const col of cols) {
      const meta = (col as { meta?: { align?: string } }).meta;
      expect(meta?.align).toMatch(/^(left|center|right)$/);
      const size = (col as { size?: number }).size;
      expect(typeof size).toBe("number");
      expect(size as number).toBeGreaterThan(0);
    }
  });

  test("IST label is left, all numerics are right", () => {
    const cols = getNiftyTapeColumns();
    const byKey = new Map(
      cols.map((c) => [c.accessorKey as string, c.meta as { align: string }]),
    );
    expect(byKey.get("t")?.align).toBe("left");
    for (const key of [
      "spot",
      "call_doi",
      "put_doi",
      "net",
      "net_pct",
      "call_tick",
      "put_tick",
      "pcr_vol",
      "pcr_oi",
      "pcr_doi",
      "spot_flip",
    ]) {
      expect(byKey.get(key)?.align).toBe("right");
    }
  });
});

describe("buildTapeHead math", () => {
  test("derives PCR OI, ΔOI since open, max pain, flip delta, walls from last row", () => {
    const rows = [
      tapeRow({ t: "09:15", pcr_doi: 0.05 }),
      tapeRow({ t: "09:16", pcr_oi: 1.15, pcr_doi: 0.08 }),
    ];
    const head = buildTapeHead(rows);
    expect(head.pcrOi).toBe(1.15);
    expect(head.pcrDoiDelta).toBeCloseTo(0.03, 10);
    expect(head.maxPain).toBe(25700);
    // flip 25762 - spot 25750.5
    expect(head.flipDeltaPts).toBeCloseTo(11.5, 10);
    expect(head.wallCall).toBe(25900);
    expect(head.wallPut).toBe(25600);
  });

  test("falls back to session summary when the last row carries zeros", () => {
    const rows = [tapeRow({ t: "09:15", pcr_oi: 0, max_pain: 0, flip: 0, walls: { call: 0, put: 0 } })];
    const head = buildTapeHead(rows, {
      date: "2026-10-12",
      interval_sec: 60,
      rows,
      pcr_oi: 0.62,
      max_pain: 22400,
      flip: 22350,
      walls: { call: 22500, put: 22200 },
    });
    expect(head.pcrOi).toBe(0.62);
    expect(head.maxPain).toBe(22400);
    expect(head.flip).toBe(22350);
    expect(head.wallCall).toBe(22500);
    expect(head.wallPut).toBe(22200);
  });

  test("zero flip yields zero delta instead of a bogus -spot", () => {
    const head = buildTapeHead([tapeRow({ t: "09:15", flip: 0 })]);
    expect(head.flipDeltaPts).toBe(0);
  });
});

describe("NiftyTapeTable", () => {
  test("renders latest minute first", () => {
    r(
      <NiftyTapeTable
        rows={[tapeRow({ t: "09:15" }), tapeRow({ t: "09:17" }), tapeRow({ t: "09:16" })]}
      />,
    );
    const table = screen.getByTestId("nifty-tape-table");
    expect(table).toBeInTheDocument();
    const rows = within(table).getAllByTestId("nifty-tape-row");
    expect(rows).toHaveLength(3);
    const times = within(table).getAllByTestId("nifty-tape-time");
    expect(times.map((el) => el.textContent)).toEqual(["09:17", "09:16", "09:15"]);
  });

  test("compact values render with M/K formatting", () => {
    r(<NiftyTapeTable rows={[tapeRow({ t: "09:15" })]} />);
    const table = screen.getByTestId("nifty-tape-table");
    expect(within(table).getByText("+170.16M")).toBeInTheDocument();
    expect(within(table).getByText("+5.53M")).toBeInTheDocument();
    expect(within(table).getByText("25,750.5")).toBeInTheDocument();
  });

  test("null spot_flip renders em dash", () => {
    r(<NiftyTapeTable rows={[tapeRow({ t: "09:15", spot_flip: null })]} />);
    const table = screen.getByTestId("nifty-tape-table");
    expect(within(table).getByText("—")).toBeInTheDocument();
  });

  test("Net cells carry a terminal brown tint, Spot-flip tints blue/brown by sign", () => {
    r(
      <NiftyTapeTable
        rows={[
          tapeRow({ t: "09:16", spot_flip: 12 }),
          tapeRow({ t: "09:15", spot_flip: -8 }),
        ]}
      />,
    );
    const table = screen.getByTestId("nifty-tape-table");
    // Net column: solid terminal brown on every row
    const netCells = within(table).getAllByText("+170.16M");
    expect(netCells.length).toBe(2);
    for (const cell of netCells) {
      // getByText returns the inner Text span; the tint lives on its parent
      const tinted = cell.parentElement;
      expect(tinted?.style.background).toMatch(/(#7A4D16|122,\s*77,\s*22)/);
    }
    // Spot-flip: positive terminal blue, negative terminal brown
    const pos = within(table).getByText("+12").parentElement;
    expect(pos?.style.background).toMatch(/rgba\(31, 127, 255/);
    const neg = within(table).getByText("-8").parentElement;
    expect(neg?.style.background).toMatch(/rgba\(219, 109, 40/);
  });

  test("header strip shows PCR OI, ΔOI since baseline, max pain, flip, walls + caption", () => {
    r(
      <NiftyTapeTable
        rows={[
          tapeRow({ t: "09:15", pcr_oi: 1.1, pcr_doi: 0.05 }),
          tapeRow({ t: "09:16", pcr_oi: 1.15, pcr_doi: 0.08 }),
        ]}
      />,
    );
    const head = screen.getByTestId("nifty-tape-head");
    expect(head).toBeInTheDocument();
    expect(within(head).getByTestId("nifty-tape-head-pcr-oi")).toHaveTextContent("1.15");
    expect(within(head).getByTestId("nifty-tape-head-pcr-doi")).toHaveTextContent("+0.03");
    // no baseline_t on the tape → honest fallback is the earliest row
    expect(within(head).getByTestId("nifty-tape-head-pcr-doi")).toHaveTextContent("PCR ΔOI since 09:15");
    expect(within(head).getByTestId("nifty-tape-head-max-pain")).toHaveTextContent("25,700");
    expect(within(head).getByTestId("nifty-tape-head-flip")).toHaveTextContent("25,762");
    expect(within(head).getByTestId("nifty-tape-head-flip")).toHaveTextContent("pts");
    expect(within(head).getByTestId("nifty-tape-head-walls")).toHaveTextContent("25,900 / 25,600");
    expect(within(head).getByText(/one per minute/)).toBeInTheDocument();
    expect(within(head).getByText(/TICKS 2/)).toBeInTheDocument();
  });

  describe("tape baseline label", () => {
    function tapeWith(baseline_t: string | undefined, rows: NiftyTapeRow[]): NiftyTape {
      return { date: "2026-10-13", interval_sec: 60, rows, ...(baseline_t ? { baseline_t } : {}) };
    }

    test("formatTapeBaseline trims ISO to HH:MM, passes bare labels through", () => {
      expect(formatTapeBaseline("2026-10-13T12:04:00+05:30")).toBe("12:04");
      expect(formatTapeBaseline("09:15")).toBe("09:15");
      expect(formatTapeBaseline(null)).toBe("");
      expect(formatTapeBaseline(undefined)).toBe("");
      expect(formatTapeBaseline("")).toBe("");
    });

    test("explicit baseline_t wins even when rows start earlier", () => {
      const rows = [tapeRow({ t: "09:15" }), tapeRow({ t: "09:16" })];
      const tape = tapeWith("2026-10-13T12:04:00+05:30", rows);
      expect(getTapeBaseline(tape, rows)).toBe("12:04");
      expect(tapeDoiLabel(tape, rows)).toBe("PCR ΔOI since 12:04");
    });

    test("falls back to the earliest row when baseline_t is absent", () => {
      const rows = [tapeRow({ t: "09:16" }), tapeRow({ t: "09:15" })];
      expect(getTapeBaseline(undefined, rows)).toBe("09:15");
      expect(getTapeBaseline(tapeWith(undefined, rows), rows)).toBe("09:15");
      expect(tapeDoiLabel(undefined, rows)).toBe("PCR ΔOI since 09:15");
    });

    test("no rows and no tape keeps the legacy since-open label", () => {
      expect(getTapeBaseline()).toBeNull();
      expect(getTapeBaseline(undefined, [])).toBeNull();
      expect(tapeDoiLabel()).toBe("PCR ΔOI since open");
    });

    test("header shows the honest baseline while the math stays unchanged", () => {
      const rows = [
        tapeRow({ t: "2026-10-13T12:04:00+05:30", pcr_oi: 1.1, pcr_doi: 0.05 }),
        tapeRow({ t: "2026-10-13T12:05:00+05:30", pcr_oi: 1.15, pcr_doi: 0.08 }),
      ];
      r(
        <NiftyTapeTable
          rows={rows}
          tape={tapeWith("2026-10-13T12:04:00+05:30", rows)}
        />,
      );
      const head = screen.getByTestId("nifty-tape-head");
      expect(within(head).getByTestId("nifty-tape-head-pcr-doi")).toHaveTextContent("PCR ΔOI since 12:04");
      expect(within(head).getByTestId("nifty-tape-head-pcr-doi")).toHaveTextContent("+0.03");
      expect(within(head).getByTestId("nifty-tape-head-pcr-oi")).toHaveTextContent("1.15");
    });
  });
});

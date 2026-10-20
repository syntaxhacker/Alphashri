// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, afterEach, vi } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import { UIProvider } from "@/ui";
import {
  NiftyTapeTable,
  buildTapeHead,
  computeChangedCells,
  computeSpotDeltas,
  computeTapeScale,
  computeTapeSession,
  formatTapeBaseline,
  formatTapeCompact,
  formatTapePct,
  formatTapePrice,
  formatTapeRatio,
  formatTapeSigned,
  formatIstClock,
  formatTapeTime,
  getNiftyTapeColumns,
  getTapeBaseline,
  tapeDoiLabel,
  tapeHeat,
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

describe("magnitude heat scale", () => {
  test("computeTapeScale takes the per-column max |value|", () => {
    const s = computeTapeScale([
      tapeRow({
        call_doi: 100,
        put_doi: -500,
        net: 20,
        net_pct: -3,
        call_tick: 7,
        put_tick: -9,
        pcr_doi: 0.5,
        spot_flip: -12,
      }),
      tapeRow({
        call_doi: -250,
        put_doi: 300,
        net: -80,
        net_pct: 1,
        call_tick: -11,
        put_tick: 4,
        pcr_doi: -0.9,
        spot_flip: null,
      }),
    ]);
    expect(s.call_doi).toBe(250);
    expect(s.put_doi).toBe(500);
    expect(s.net).toBe(80);
    expect(s.net_pct).toBe(3);
    expect(s.call_tick).toBe(11);
    expect(s.put_tick).toBe(9);
    expect(s.pcr_doi).toBe(0.9);
    expect(s.spot_flip).toBe(12);
  });

  test("empty rows yield a zero scale (no tint anywhere)", () => {
    const s = computeTapeScale([]);
    expect(Object.values(s).every((v) => v === 0)).toBe(true);
  });

  test("tapeHeat alpha grows with magnitude; zero/max<=0 → undefined", () => {
    expect(tapeHeat(0, 100, "#1F7FFF")).toBeUndefined();
    expect(tapeHeat(5, 0, "#1F7FFF")).toBeUndefined();
    const alpha = (s: string | undefined) =>
      s ? Number(s.match(/,\s*([0-9.]+)\)/)?.[1] ?? 0) : 0;
    const lo = alpha(tapeHeat(10, 100, "#1F7FFF", 0, 1));
    const hi = alpha(tapeHeat(100, 100, "#1F7FFF", 0, 1));
    expect(lo).toBeCloseTo(0.1, 5);
    expect(hi).toBeCloseTo(1, 5);
    expect(hi).toBeGreaterThan(lo);
  });
});

describe("spot deltas + session roll-up", () => {
  test("computeSpotDeltas keys each minute to its change vs the previous", () => {
    const rows = [
      tapeRow({ t: "09:15", spot: 22500 }),
      tapeRow({ t: "09:16", spot: 22510 }),
      tapeRow({ t: "09:17", spot: 22495 }),
    ];
    const d = computeSpotDeltas(rows);
    expect(d.has("09:15")).toBe(false);
    expect(d.get("09:16")).toBeCloseTo(10, 5);
    expect(d.get("09:17")).toBeCloseTo(-15, 5);
  });

  test("computeTapeSession reports spot range, biggest prints and net sum", () => {
    const s = computeTapeSession([
      tapeRow({ spot: 22500, call_doi: 100, put_doi: -500, net: 20 }),
      tapeRow({ spot: 22600, call_doi: -250, put_doi: 300, net: -80 }),
    ]);
    expect(s.spotLo).toBe(22500);
    expect(s.spotHi).toBe(22600);
    expect(s.maxCallDoi).toBe(250);
    expect(s.maxPutDoi).toBe(500);
    expect(s.netSum).toBeCloseTo(-60, 5);
  });

  test("computeTapeSession on empty rows is all zeros", () => {
    const s = computeTapeSession([]);
    expect(s).toEqual({ spotHi: 0, spotLo: 0, maxCallDoi: 0, maxPutDoi: 0, netSum: 0 });
  });

  test("Spot cell shows a tick arrow when a prior minute exists", () => {
    r(
      <NiftyTapeTable
        rows={[
          tapeRow({ t: "09:15", spot: 22500 }),
          tapeRow({ t: "09:16", spot: 22510 }),
        ]}
      />,
    );
    const table = screen.getByTestId("nifty-tape-table");
    expect(within(table).getByText("▲")).toBeInTheDocument();
    expect(within(table).getByText("22,510")).toBeInTheDocument();
  });

  test("session footer renders spot range, max prints, net sum + heat legend", () => {
    r(<NiftyTapeTable rows={[tapeRow({ t: "09:15" }), tapeRow({ t: "09:16" })]} />);
    const head = screen.getByTestId("nifty-tape-head");
    expect(within(head).getByText(/SPOT [\d.,]+–[\d.,]+/)).toBeInTheDocument();
    expect(within(head).getByText(/MAX ΔOI/)).toBeInTheDocument();
    expect(within(head).getByText(/NET Σ/)).toBeInTheDocument();
    expect(screen.getByTestId("nifty-tape-heat-legend")).toHaveTextContent("brighter = bigger print");
  });

  test("order toggle flips the first row between newest and oldest", () => {
    r(
      <NiftyTapeTable
        rows={[
          tapeRow({ t: "09:15" }),
          tapeRow({ t: "09:16" }),
          tapeRow({ t: "09:17" }),
        ]}
      />,
    );
    const table = screen.getByTestId("nifty-tape-table");
    const times = () => within(table).getAllByTestId("nifty-tape-time").map((el) => el.textContent);
    expect(times()[0]).toBe("09:17");
    fireEvent.click(screen.getByTestId("nifty-tape-order-toggle"));
    expect(times()[0]).toBe("09:15");
    // the newest row keeps its accent even when listed last
    const rows = within(table).getAllByTestId("nifty-tape-row");
    expect(rows[rows.length - 1].className).toContain("tape-latest");
  });
});

describe("live change detection", () => {
  test("computeChangedCells reports only fields that actually moved", () => {
    const prev = new Map([
      ["09:15", tapeRow({ t: "09:15", call_doi: 100, net: 5, spot: 100 })],
      ["09:16", tapeRow({ t: "09:16", call_doi: 200, net: 6, spot: 101 })],
    ]);
    const rows = [
      tapeRow({ t: "09:15", call_doi: 100, net: 5, spot: 100 }), // unchanged
      tapeRow({ t: "09:16", call_doi: 250, net: 6, spot: 103 }), // call_doi + spot moved
      tapeRow({ t: "09:17", call_doi: 999, net: 9, spot: 104 }), // brand new
    ];
    const out = computeChangedCells(prev, rows);
    expect(out.has("09:15")).toBe(false);
    expect([...(out.get("09:16") ?? [])].sort()).toEqual(["call_doi", "spot"]);
    // new minutes are the row-flash event, never a cell-change
    expect(out.has("09:17")).toBe(false);
  });

  test("computeChangedCells on an empty previous snapshot reports nothing", () => {
    expect(computeChangedCells(new Map(), [tapeRow({ t: "09:15" })]).size).toBe(0);
  });

  test("live mode shows the pulsing LIVE dot; EOD hides it", () => {
    const { rerender } = r(<NiftyTapeTable rows={[tapeRow({ t: "09:15" })]} live />);
    expect(screen.getByTestId("nifty-tape-live")).toHaveTextContent("LIVE");
    rerender(<NiftyTapeTable rows={[tapeRow({ t: "09:15" })]} />);
    expect(screen.queryByTestId("nifty-tape-live")).not.toBeInTheDocument();
  });

  test("a newly arrived minute flashes; a revised existing minute flashes its cells", () => {
    const { rerender, container } = r(
      <NiftyTapeTable rows={[tapeRow({ t: "09:15", call_doi: 100 })]} />,
    );
    // same minute, revised value → cell flash only
    rerender(<NiftyTapeTable rows={[tapeRow({ t: "09:15", call_doi: 999 })]} />);
    expect(container.querySelectorAll(".tape-cell-flash").length).toBeGreaterThan(0);
    // brand-new minute → row flash on the newest row
    rerender(
      <NiftyTapeTable
        rows={[tapeRow({ t: "09:15", call_doi: 999 }), tapeRow({ t: "09:16", call_doi: 500 })]}
      />,
    );
    const rows = within(screen.getByTestId("nifty-tape-table")).getAllByTestId("nifty-tape-row");
    expect(rows[0].className).toContain("tape-flash");
  });

  test("an unchanged snapshot schedules no clear timer and lights no flash", () => {
    vi.useFakeTimers();
    try {
      const first = [tapeRow({ t: "09:15", call_doi: 100 })];
      const { rerender, container } = r(<NiftyTapeTable rows={first} />);
      // A brand-new minute on the NEXT snapshot is the row flash; here the
      // re-pushed snapshot carries identical values under new identities.
      const again = [{ ...first[0] }];
      const timersAfterMount = vi.getTimerCount();
      rerender(<NiftyTapeTable rows={again} />);
      // No moved cells → no setChanged, no restarted 1.6s timer: an idle
      // tick costs the diff effect alone, not a second full render cycle.
      expect(vi.getTimerCount()).toBe(timersAfterMount);
      expect(container.querySelectorAll(".tape-cell-flash")).toHaveLength(0);
      expect(container.querySelectorAll(".tape-flash")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
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

  test("newest minute carries the tape-latest class, older rows do not", () => {
    r(
      <NiftyTapeTable
        rows={[tapeRow({ t: "09:15" }), tapeRow({ t: "09:17" }), tapeRow({ t: "09:16" })]}
      />,
    );
    const rows = within(screen.getByTestId("nifty-tape-table")).getAllByTestId("nifty-tape-row");
    expect(rows[0].className).toContain("tape-latest");
    expect(rows[1].className).not.toContain("tape-latest");
    expect(rows[2].className).not.toContain("tape-latest");
  });

  test("Call ΔOI fill strength scales with magnitude", () => {
    r(
      <NiftyTapeTable
        rows={[
          tapeRow({ t: "09:16", call_doi: 5_530_000 }),
          tapeRow({ t: "09:15", call_doi: 553_000 }),
        ]}
      />,
    );
    const table = screen.getByTestId("nifty-tape-table");
    const alpha = (el: HTMLElement | null) =>
      Number((el?.style.background ?? "").match(/,\s*([0-9.]+)\)/)?.[1] ?? 0);
    const big = alpha(within(table).getByText("+5.53M").parentElement);
    const small = alpha(within(table).getByText("+553.00K").parentElement);
    expect(big).toBeGreaterThan(small);
    expect(big).toBeGreaterThan(0);
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

describe("tape burst spine", () => {
  test("burst minutes carry the side-specific spine class", () => {
    r(
      <NiftyTapeTable
        rows={[tapeRow({ t: "09:15" }), tapeRow({ t: "09:16" }), tapeRow({ t: "09:17" })]}
        bursts={
          new Map([
            ["09:15", "call"],
            ["09:16", "put"],
          ])
        }
      />,
    );
    const table = screen.getByTestId("nifty-tape-table");
    const rows = within(table).getAllByTestId("nifty-tape-row");
    const byTime = new Map(
      within(table)
        .getAllByTestId("nifty-tape-time")
        .map((el, i) => [el.textContent, rows[i]]),
    );
    expect(byTime.get("09:15")?.className).toContain("tape-burst-call");
    expect(byTime.get("09:16")?.className).toContain("tape-burst-put");
    expect(byTime.get("09:17")?.className).not.toContain("tape-burst");
  });

  test("the newest burst minute carries both tape-latest and the burst class", () => {
    r(
      <NiftyTapeTable
        rows={[tapeRow({ t: "09:15" }), tapeRow({ t: "09:16" })]}
        bursts={new Map([["09:16", "call"]])}
      />,
    );
    const rows = within(screen.getByTestId("nifty-tape-table")).getAllByTestId("nifty-tape-row");
    // newest-first → row 0 is 09:16, the newest AND a burst minute
    expect(rows[0].className).toContain("tape-latest");
    expect(rows[0].className).toContain("tape-burst-call");
  });

  test("a row absent from the bursts map gets no burst class", () => {
    r(
      <NiftyTapeTable
        rows={[tapeRow({ t: "09:15" }), tapeRow({ t: "09:16" })]}
        bursts={new Map([["09:15", "call"]])}
      />,
    );
    const rows = within(screen.getByTestId("nifty-tape-table")).getAllByTestId("nifty-tape-row");
    // newest-first → 09:16 (absent) is row 0, 09:15 (call burst) is row 1
    expect(rows[0].className).not.toContain("tape-burst");
    expect(rows[1].className).toContain("tape-burst-call");
  });

  test("heat legend renders the burst-minute key", () => {
    r(<NiftyTapeTable rows={[tapeRow({ t: "09:15" })]} />);
    const legend = screen.getByTestId("nifty-tape-heat-legend");
    expect(within(legend).getByTestId("nifty-tape-burst-legend")).toHaveTextContent("burst minute");
  });
});

describe("last / next update stamps", () => {
  const T = Date.parse("2026-10-14T12:03:15+05:30");
  const N = T + 30_000;

  test("formatIstClock renders IST HH:MM:SS host-TZ independently", () => {
    expect(formatIstClock(T)).toBe("12:03:15");
    expect(formatIstClock(Date.parse("2026-10-14T06:33:15Z"))).toBe("12:03:15");
    expect(formatIstClock(NaN)).toBe("—");
  });

  test("the tape header shows upd + next when a refresh time is supplied", () => {
    r(
      <NiftyTapeTable
        rows={[tapeRow({ t: "09:15" })]}
        updatedAtMs={T}
        nextUpdateAtMs={N}
      />,
    );
    const el = screen.getByTestId("nifty-tape-updated");
    expect(el).toHaveTextContent("upd 12:03:15");
    expect(el).toHaveTextContent("next 12:03:45");
  });

  test("no stamp without a refresh time, and next is optional", () => {
    const { rerender } = r(<NiftyTapeTable rows={[tapeRow({ t: "09:15" })]} />);
    expect(screen.queryByTestId("nifty-tape-updated")).not.toBeInTheDocument();

    rerender(<NiftyTapeTable rows={[tapeRow({ t: "09:15" })]} updatedAtMs={T} />);
    const el = screen.getByTestId("nifty-tape-updated");
    expect(el).toHaveTextContent("upd 12:03:15");
    expect(el).not.toHaveTextContent("next");
  });
});

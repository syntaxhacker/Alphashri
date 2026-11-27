// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import { screen, within } from "@solidjs/testing-library";
import { NiftyTapeTable, getNiftyTapeColumns } from "./NiftyTapeTable";
import { r, tapeRow, tapeWith, T, N } from "./NiftyTapeTable.fixtures";

vi.mock("@/components/common/states", () => ({ InlineLoader: () => null }));

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

describe("NiftyTapeTable rendering", () => {
  test("renders latest minute first", () => {
    r(() => (
      <NiftyTapeTable
        rows={[tapeRow({ t: "09:15" }), tapeRow({ t: "09:17" }), tapeRow({ t: "09:16" })]}
      />
    ));
    const table = screen.getByTestId("nifty-tape-table");
    expect(table).toBeInTheDocument();
    const rows = within(table).getAllByTestId("nifty-tape-row");
    expect(rows).toHaveLength(3);
    const times = within(table).getAllByTestId("nifty-tape-time");
    expect(times.map((el) => el.textContent)).toEqual(["09:17", "09:16", "09:15"]);
  });

  test("newest minute carries the tape-latest class, older rows do not", () => {
    r(() => (
      <NiftyTapeTable
        rows={[tapeRow({ t: "09:15" }), tapeRow({ t: "09:17" }), tapeRow({ t: "09:16" })]}
      />
    ));
    const rows = within(screen.getByTestId("nifty-tape-table")).getAllByTestId("nifty-tape-row");
    expect(rows[0].className).toContain("tape-latest");
    expect(rows[1].className).not.toContain("tape-latest");
    expect(rows[2].className).not.toContain("tape-latest");
  });

  test("Call ΔOI fill strength scales with magnitude", () => {
    r(() => (
      <NiftyTapeTable
        rows={[
          tapeRow({ t: "09:16", call_doi: 5_530_000 }),
          tapeRow({ t: "09:15", call_doi: 553_000 }),
        ]}
      />
    ));
    const table = screen.getByTestId("nifty-tape-table");
    const alpha = (el: HTMLElement | null) =>
      Number((el?.style.background ?? "").match(/,\s*([0-9.]+)\)/)?.[1] ?? 0);
    const big = alpha(within(table).getByText("+5.53M").parentElement);
    const small = alpha(within(table).getByText("+553.00K").parentElement);
    expect(big).toBeGreaterThan(small);
    expect(big).toBeGreaterThan(0);
  });

  test("compact values render with M/K formatting", () => {
    r(() => <NiftyTapeTable rows={[tapeRow({ t: "09:15" })]} />);
    const table = screen.getByTestId("nifty-tape-table");
    expect(within(table).getByText("+170.16M")).toBeInTheDocument();
    expect(within(table).getByText("+5.53M")).toBeInTheDocument();
    expect(within(table).getByText("25,750.5")).toBeInTheDocument();
  });

  test("Net cells carry a terminal brown tint, Spot-flip tints blue/brown by sign", () => {
    r(() => (
      <NiftyTapeTable
        rows={[
          tapeRow({ t: "09:16", spot_flip: 12 }),
          tapeRow({ t: "09:15", spot_flip: -8 }),
        ]}
      />
    ));
    const table = screen.getByTestId("nifty-tape-table");
    const netCells = within(table).getAllByText("+170.16M");
    expect(netCells.length).toBe(2);
    for (const cell of netCells) {
      const tinted = cell.parentElement;
      expect(tinted?.style.background).toMatch(/(#7A4D16|122,\s*77,\s*22)/);
    }
    const pos = within(table).getByText("+12").parentElement;
    expect(pos?.style.background).toMatch(/rgba\(31, 127, 255/);
    const neg = within(table).getByText("-8").parentElement;
    expect(neg?.style.background).toMatch(/rgba\(219, 109, 40/);
  });

  test("Net header states put−call, matching the column's sign convention", () => {
    r(() => (
      <NiftyTapeTable
        rows={[tapeRow({ t: "09:15", net: 10 }), tapeRow({ t: "09:16", net: -20 })]}
      />
    ));
    const table = screen.getByTestId("nifty-tape-table");
    expect(within(table).getByText("put−call")).toBeInTheDocument();
    expect(within(table).getByText(/spot−flip/i)).toBeInTheDocument();
    const head = screen.getByTestId("nifty-tape-head");
    expect(within(head).getByText("-20")).toBeInTheDocument();
  });

  test("header strip shows PCR OI, ΔOI since baseline, max pain, flip, walls + caption", () => {
    r(() => (
      <NiftyTapeTable
        rows={[
          tapeRow({ t: "09:15", pcr_oi: 1.1, pcr_doi: 0.05 }),
          tapeRow({ t: "09:16", pcr_oi: 1.15, pcr_doi: 0.08 }),
        ]}
      />
    ));
    const head = screen.getByTestId("nifty-tape-head");
    expect(head).toBeInTheDocument();
    expect(within(head).getByTestId("nifty-tape-head-pcr-oi")).toHaveTextContent("1.15");
    expect(within(head).getByTestId("nifty-tape-head-pcr-doi")).toHaveTextContent("+0.03");
    expect(within(head).getByTestId("nifty-tape-head-pcr-doi")).toHaveTextContent("PCR ΔOI since 09:15");
    expect(within(head).getByTestId("nifty-tape-head-max-pain")).toHaveTextContent("25,700");
    expect(within(head).getByTestId("nifty-tape-head-flip")).toHaveTextContent("25,762");
    expect(within(head).getByTestId("nifty-tape-head-flip")).toHaveTextContent("pts");
    expect(within(head).getByTestId("nifty-tape-head-walls")).toHaveTextContent("25,900 / 25,600");
    expect(within(head).getByText(/one per minute/)).toBeInTheDocument();
    expect(within(head).getByText(/TICKS 2/)).toBeInTheDocument();
  });

  test("header shows the honest baseline while the math stays unchanged", () => {
    const rows = [
      tapeRow({ t: "2026-10-13T12:04:00+05:30", pcr_oi: 1.1, pcr_doi: 0.05 }),
      tapeRow({ t: "2026-10-13T12:05:00+05:30", pcr_oi: 1.15, pcr_doi: 0.08 }),
    ];
    r(() => (
      <NiftyTapeTable
        rows={rows}
        tape={tapeWith("2026-10-13T12:04:00+05:30", rows)}
      />
    ));
    const head = screen.getByTestId("nifty-tape-head");
    expect(within(head).getByTestId("nifty-tape-head-pcr-doi")).toHaveTextContent("PCR ΔOI since 12:04");
    expect(within(head).getByTestId("nifty-tape-head-pcr-doi")).toHaveTextContent("+0.03");
    expect(within(head).getByTestId("nifty-tape-head-pcr-oi")).toHaveTextContent("1.15");
  });
});

describe("tape session rendering", () => {
  test("Spot cell shows a tick arrow when a prior minute exists", () => {
    r(() => (
      <NiftyTapeTable
        rows={[
          tapeRow({ t: "09:15", spot: 22500 }),
          tapeRow({ t: "09:16", spot: 22510 }),
        ]}
      />
    ));
    const table = screen.getByTestId("nifty-tape-table");
    expect(within(table).getByText("▲")).toBeInTheDocument();
    expect(within(table).getByText("22,510")).toBeInTheDocument();
  });

  test("session footer renders spot range, max prints, net sum + heat legend", () => {
    r(() => <NiftyTapeTable rows={[tapeRow({ t: "09:15" }), tapeRow({ t: "09:16" })]} />);
    const head = screen.getByTestId("nifty-tape-head");
    expect(within(head).getByText(/SPOT [\d.,]+–[\d.,]+/)).toBeInTheDocument();
    expect(within(head).getByText(/MAX ΔOI/)).toBeInTheDocument();
    expect(within(head).getByText("NET")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-tape-heat-legend")).toHaveTextContent("brighter = bigger print");
  });
});

describe("tape burst spine", () => {
  test("burst minutes carry the side-specific spine class", () => {
    r(() => (
      <NiftyTapeTable
        rows={[tapeRow({ t: "09:15" }), tapeRow({ t: "09:16" }), tapeRow({ t: "09:17" })]}
        bursts={
          new Map([
            ["09:15", "call"],
            ["09:16", "put"],
          ])
        }
      />
    ));
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
    r(() => (
      <NiftyTapeTable
        rows={[tapeRow({ t: "09:15" }), tapeRow({ t: "09:16" })]}
        bursts={new Map([["09:16", "call"]])}
      />
    ));
    const rows = within(screen.getByTestId("nifty-tape-table")).getAllByTestId("nifty-tape-row");
    expect(rows[0].className).toContain("tape-latest");
    expect(rows[0].className).toContain("tape-burst-call");
  });

  test("a row absent from the bursts map gets no burst class", () => {
    r(() => (
      <NiftyTapeTable
        rows={[tapeRow({ t: "09:15" }), tapeRow({ t: "09:16" })]}
        bursts={new Map([["09:15", "call"]])}
      />
    ));
    const rows = within(screen.getByTestId("nifty-tape-table")).getAllByTestId("nifty-tape-row");
    expect(rows[0].className).not.toContain("tape-burst");
    expect(rows[1].className).toContain("tape-burst-call");
  });

  test("heat legend renders the burst-minute key", () => {
    r(() => <NiftyTapeTable rows={[tapeRow({ t: "09:15" })]} />);
    const legend = screen.getByTestId("nifty-tape-heat-legend");
    expect(within(legend).getByTestId("nifty-tape-burst-legend")).toHaveTextContent("burst minute");
  });
});

describe("last / next update stamps", () => {
  test("the tape header shows upd + next when a refresh time is supplied", () => {
    r(() => (
      <NiftyTapeTable
        rows={[tapeRow({ t: "09:15" })]}
        updatedAtMs={T}
        nextUpdateAtMs={N}
      />
    ));
    const el = screen.getByTestId("nifty-tape-updated");
    expect(el).toHaveTextContent("upd 12:03:15");
    expect(el).toHaveTextContent("next 12:03:45");
  });
});

// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import { screen, within, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { NiftyTapeTable } from "./NiftyTapeTable";
import { r, tapeRow, manyRows, T } from "./NiftyTapeTable.fixtures";

// Count tape sorts without changing behaviour: the wrapper forwards to the
// real sorter. Guards the per-tick budget (seven derivations used to sort the
// same snapshot independently).
const perf = vi.hoisted(() => ({ ascSorts: 0 }));
vi.mock("./tapeRange", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tapeRange")>();
  return {
    ...actual,
    ascTapeByTime: (rows: Parameters<typeof actual.ascTapeByTime>[0]) => {
      perf.ascSorts += 1;
      return actual.ascTapeByTime(rows);
    },
  };
});

vi.mock("@/components/common/states", () => ({ InlineLoader: () => null }));

describe("tape interactions", () => {
  test("order toggle flips the first row between newest and oldest", () => {
    r(() => (
      <NiftyTapeTable
        rows={[
          tapeRow({ t: "09:15" }),
          tapeRow({ t: "09:16" }),
          tapeRow({ t: "09:17" }),
        ]}
      />
    ));
    const table = screen.getByTestId("nifty-tape-table");
    const times = () => within(table).getAllByTestId("nifty-tape-time").map((el) => el.textContent);
    expect(times()[0]).toBe("09:17");
    fireEvent.click(screen.getByTestId("nifty-tape-order-toggle"));
    expect(times()[0]).toBe("09:15");
    const rows = within(table).getAllByTestId("nifty-tape-row");
    expect(rows[rows.length - 1].className).toContain("tape-latest");
  });

  test("live mode shows the pulsing LIVE dot; EOD hides it", () => {
    const [live, setLive] = createSignal(true);
    r(() => <NiftyTapeTable rows={[tapeRow({ t: "09:15" })]} live={live()} />);
    expect(screen.getByTestId("nifty-tape-live")).toHaveTextContent("LIVE");
    setLive(false);
    expect(screen.queryByTestId("nifty-tape-live")).not.toBeInTheDocument();
  });

  test("a newly arrived minute flashes; a revised existing minute flashes its cells", () => {
    const [rows, setRows] = createSignal([tapeRow({ t: "09:15", call_doi: 100 })]);
    const { container } = r(() => <NiftyTapeTable rows={rows()} />);
    setRows([tapeRow({ t: "09:15", call_doi: 999 })]);
    expect(container.querySelectorAll(".tape-cell-flash").length).toBeGreaterThan(0);
    setRows([tapeRow({ t: "09:15", call_doi: 999 }), tapeRow({ t: "09:16", call_doi: 500 })]);
    const rowEls = within(screen.getByTestId("nifty-tape-table")).getAllByTestId("nifty-tape-row");
    expect(rowEls[0].className).toContain("tape-flash");
  });

  test("an unchanged snapshot schedules no clear timer and lights no flash", () => {
    vi.useFakeTimers();
    try {
      const first = [tapeRow({ t: "09:15", call_doi: 100 })];
      const [rows, setRows] = createSignal(first);
      const { container } = r(() => <NiftyTapeTable rows={rows()} />);
      const again = [{ ...first[0] }];
      const timersAfterMount = vi.getTimerCount();
      setRows(again);
      expect(vi.getTimerCount()).toBe(timersAfterMount);
      expect(container.querySelectorAll(".tape-cell-flash")).toHaveLength(0);
      expect(container.querySelectorAll(".tape-flash")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("no stamp without a refresh time, and next is optional", () => {
    const [updatedAtMs, setUpdatedAtMs] = createSignal<number | undefined>(undefined);
    r(() => <NiftyTapeTable rows={[tapeRow({ t: "09:15" })]} updatedAtMs={updatedAtMs()} />);
    expect(screen.queryByTestId("nifty-tape-updated")).not.toBeInTheDocument();

    setUpdatedAtMs(T);
    const el = screen.getByTestId("nifty-tape-updated");
    expect(el).toHaveTextContent("upd 12:03:15");
    expect(el).not.toHaveTextContent("next");
  });
});

describe("tape sort budget", () => {
  test("one tape sort per snapshot, not one per derivation", () => {
    vi.useFakeTimers();
    try {
      perf.ascSorts = 0;
      const [feed, setFeed] = createSignal(manyRows(240));
      r(() => <NiftyTapeTable rows={feed()} />);
      expect(perf.ascSorts).toBe(1);

      // A tick with a fresh-but-equivalent array (one non-flash field revised)
      // still recomputes every derivation — but sorts the rows only once.
      perf.ascSorts = 0;
      const next = manyRows(240);
      next[0] = { ...next[0], pcr_vol: 1.23 };
      setFeed(next);
      expect(perf.ascSorts).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

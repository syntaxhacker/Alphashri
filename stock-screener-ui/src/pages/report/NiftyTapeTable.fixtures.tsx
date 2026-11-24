import { afterEach } from "vitest";
import type { JSX } from "solid-js";
import { cleanup, render } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { NiftyTape, NiftyTapeRow } from "@/types/niftyReport";

export function r(ui: () => JSX.Element) {
  return render(() => <UIProvider>{ui()}</UIProvider>);
}

export function tapeRow(overrides?: Partial<NiftyTapeRow>): NiftyTapeRow {
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

export function tapeWith(baseline_t: string | undefined, rows: NiftyTapeRow[]): NiftyTape {
  return { date: "2026-10-13", interval_sec: 60, rows, ...(baseline_t ? { baseline_t } : {}) };
}

export function manyRows(n: number): NiftyTapeRow[] {
  return Array.from({ length: n }, (_, i) => {
    const min = 9 * 60 + 15 + i;
    const t = `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
    return tapeRow({ t, spot: 25_000 + i, call_doi: i, put_doi: -i, net: i });
  }).reverse(); // worst case for a stable ascending sort
}

export const T = Date.parse("2026-10-14T12:03:15+05:30");
export const N = T + 30_000;

afterEach(() => {
  cleanup();
});

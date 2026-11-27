import type { NiftyTapeRow } from "@/types/niftyReport";

export function hm(i: number): string {
  const total = 9 * 60 + 15 + i;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function tapeRow(t: string, callDoi: number, putDoi: number, spot = 22_550): NiftyTapeRow {
  return {
    t,
    spot,
    call_doi: callDoi,
    put_doi: putDoi,
    net: putDoi - callDoi,
    net_pct: 0,
    call_tick: 1_000,
    put_tick: 1_000,
    pcr_vol: 1,
    pcr_oi: 1,
    pcr_doi: 0,
    spot_flip: 0,
    max_pain: 22_550,
    flip: 22_500,
    walls: { call: 22_600, put: 22_500 },
  };
}

/** Build rows whose per-minute CALL deltas follow `deltas` (cumulative OI). */
export function callSeries(deltas: number[]): NiftyTapeRow[] {
  let cum = 0;
  const rows: NiftyTapeRow[] = [tapeRow(hm(0), 0, 0)];
  deltas.forEach((d, i) => {
    cum += d;
    rows.push(tapeRow(hm(i + 1), cum, 0));
  });
  return rows;
}

export function putSeries(deltas: number[]): NiftyTapeRow[] {
  let cum = 0;
  const rows: NiftyTapeRow[] = [tapeRow(hm(0), 0, 0)];
  deltas.forEach((d, i) => {
    cum += d;
    rows.push(tapeRow(hm(i + 1), 0, cum));
  });
  return rows;
}

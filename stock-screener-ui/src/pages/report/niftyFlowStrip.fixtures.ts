import type { FlowTapeRow } from "./niftyFlowStrip";
import { hm } from "./reportTestFixtures";

export function base(over: Partial<FlowTapeRow> = {}): FlowTapeRow {
  return {
    t: hm(0),
    call_doi: 0,
    put_doi: 0,
    max_pain: 25700,
    atm_strike: 25750,
    walls: { call: 25900, put: 25600 },
    ...over,
  };
}

/** Six Put unwind minutes followed by four Call builds — the reported live tape. */
export function liveTapeRows(): FlowTapeRow[] {
  return [
    base({ t: hm(0), put_doi: 20_000_000 }),
    base({ t: hm(1), put_doi: 17_310_000 }), // −2.69M
    base({ t: hm(2), put_doi: 14_580_000 }), // −2.73M
    base({ t: hm(3), put_doi: 12_470_000 }), // −2.11M
    base({ t: hm(4), put_doi: 9_720_000 }), // −2.75M
    base({ t: hm(5), put_doi: 6_790_000 }), // −2.93M
    base({ t: hm(6), put_doi: 4_060_000 }), // −2.73M
    base({ t: hm(7), put_doi: 4_060_000, call_doi: 3_140_000 }), // +3.14M
    base({ t: hm(8), put_doi: 4_060_000, call_doi: 5_390_000 }), // +2.25M
    base({ t: hm(9), put_doi: 4_060_000, call_doi: 7_640_000 }), // +2.25M
    base({ t: hm(10), put_doi: 4_060_000, call_doi: 9_820_000 }), // +2.18M
  ];
}

/** One neutral row then `n` max-pain steps of +50. */
export function maxPainStaircase(n: number): FlowTapeRow[] {
  const rows: FlowTapeRow[] = [base({ t: hm(0) })];
  for (let i = 1; i <= n; i++) rows.push(base({ t: hm(i), max_pain: 25700 + i * 50 }));
  return rows;
}

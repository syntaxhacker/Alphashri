// Shared expectation cases for the formatNumber "thousands" spec, used by
// ui-helpers.test.ts and components/bots/status.test.ts.
export const THOUSANDS_K_CASES: ReadonlyArray<readonly [number, string]> = [
  [1500, "1.5K"],
  [10000, "10.0K"],
  [99999, "100.0K"],
];

/** Shared chart-test candles (test-only module; never import from production). */
export function makeCandles() {
  return [
    { open: 100, close: 105, high: 110, low: 95 },
    { open: 105, close: 103, high: 108, low: 102 },
  ];
}

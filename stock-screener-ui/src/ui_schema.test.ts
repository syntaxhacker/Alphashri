import { describe, expect, test } from "vitest";
import { getColumnKeysForProfile } from "./ui_schema";

describe("ui schema dynamic header mapping", () => {
  test("market open uses gap columns", () => {
    const cols = getColumnKeysForProfile("market_open_gap", false);
    expect(cols).toEqual([
      "symbol",
      "score",
      "gap_pct",
      "premarket_change",
      "day_change",
      "volume_m",
      "sector",
    ]);
  });

  test("rsi reversal uses oscillator columns", () => {
    const cols = getColumnKeysForProfile("rsi_reversal", false);
    expect(cols).toEqual(["symbol", "score", "rsi", "stoch_k", "day_change", "volume_m", "sector"]);
  });

  test("default profile returns trending columns", () => {
    const cols = getColumnKeysForProfile("trending", false);
    expect(cols).toEqual([
      "symbol",
      "score",
      "tv_price",
      "upstox_price",
      "broker_diff",
      "high_52w",
      "to_52w_high",
      "recent_return_5d",
      "perf_w",
      "sector",
    ]);
  });
});

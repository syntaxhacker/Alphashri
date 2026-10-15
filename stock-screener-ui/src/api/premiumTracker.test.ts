// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchPremiumTracker } from "./premiumTracker";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const payload = {
  legs: [
    {
      underlying: "NIFTY",
      spot: 23140,
      atm_strike: 23150,
      ce_ltp: 90,
      pe_ltp: 106,
      straddle_price: 196,
      straddle_pct: 0.847,
      ce_iv_pct: 25.2,
      pe_iv_pct: 15.3,
      dte_days: 1,
      hv20_ann_pct: 9.2,
      hv20_daily_pct: 0.58,
      avg_range20_pct: 0.71,
      iv_hv_ratio: 2.73,
      verdict: "EXPENSIVE",
      error: null,
    },
  ],
  as_of: "2026-09-27T00:00:00+00:00",
  cached: false,
};

describe("fetchPremiumTracker", () => {
  it("returns the snapshot on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) }));
    const data = await fetchPremiumTracker();
    expect(data.legs).toHaveLength(1);
    expect(data.legs[0].verdict).toBe("EXPENSIVE");
  });

  it("throws with server detail on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ detail: "no token" }) }),
    );
    await expect(fetchPremiumTracker()).rejects.toThrow("no token");
  });
});

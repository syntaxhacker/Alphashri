import { describe, expect, test } from "vitest";
import { scorePreMove, type PreMoveInput } from "./niftyPreMove";
import type { OiPoint } from "./niftyFlowRead";

/** 10 s snapshots from 13:12:00 to 13:18:00, newest last. */
function points(): OiPoint[] {
  const out: OiPoint[] = [];
  let ceOi = 100_000_000;
  let peOi = 100_000_000;
  let cePrem = 130;
  let pePrem = 95;
  for (let i = 0; i <= 36; i++) {
    const minute = 12 + Math.floor(i / 6);
    const sec = (i % 6) * 10;
    const t = `2026-10-26T13:${String(minute).padStart(2, "0")}:${String(sec).padStart(2, "0")}+05:30`;
    if (i < 24) {
      // 13:12–13:16 — put writing: put OI builds, put premium falls.
      peOi += 50_000;
      pePrem -= 0.15;
    } else {
      // 13:16–13:18 — call buying: call OI builds, call premium bid.
      ceOi += 50_000;
      cePrem += 1.5;
    }
    out.push({
      t,
      ce: ceOi,
      pe: peOi,
      spot: 22_613 + i * 0.5,
      cePrem,
      pePrem,
    });
  }
  return out;
}

function input(over: Partial<PreMoveInput> = {}): PreMoveInput {
  return {
    points: points(),
    rows: [
      { t: "13:13", net_gex: -30 },
      { t: "13:14", net_gex: -20 },
      { t: "13:15", net_gex: -10 },
      { t: "13:16", net_gex: 5 },
      { t: "13:17", net_gex: 12 },
      { t: "13:18", net_gex: 20 },
    ],
    pressure: { lastRatio: 1.6, last3Ratio: 1.9 },
    regime: { iv: 22.9, rv: 18.5 },
    ...over,
  };
}

describe("scorePreMove", () => {
  test("the 13:19 setup arms on the positioning sequence", () => {
    const s = scorePreMove(input());
    const keys = s.components.map((c) => c.key);
    expect(keys).toContain("put-writing");
    expect(keys).toContain("call-build");
    expect(keys).toContain("call-premium");
    expect(keys).toContain("gex");
    expect(keys).toContain("rvol");
    expect(keys).toContain("iv-rich");
    // 2+2+1+1+1−2 = 5 → armed
    expect(s.score).toBe(5);
    expect(s.state).toBe("armed");
    expect(s.reasons).toContain("puts sold");
    expect(s.reasons).toContain("calls bought");
  });

  test("rich premium is a real penalty: without it the score is higher", () => {
    const rich = scorePreMove(input());
    const cheap = scorePreMove(input({ regime: { iv: 17, rv: 18.5 } }));
    expect(cheap.score).toBe(rich.score + 2);
    expect(cheap.components.some((c) => c.key === "iv-rich")).toBe(false);
  });

  test("a flat tape is quiet", () => {
    const flat = points().map((p) => ({
      ...p,
      ce: 100_000_000,
      pe: 100_000_000,
      cePrem: 130,
      pePrem: 95,
    }));
    const s = scorePreMove(input({ points: flat, rows: [], pressure: { lastRatio: 0.8, last3Ratio: 0.7 } }));
    expect(s.state).toBe("quiet");
    expect(s.score).toBe(0);
  });

  test("put writing plus volume alone is watch, not armed", () => {
    const s = scorePreMove(
      input({
        points: points().slice(0, 25),
        rows: [],
        pressure: { lastRatio: 1.9, last3Ratio: 1.9 },
        regime: null,
      }),
    );
    // put-writing (2) + rvol (1); the call phase has not started yet.
    expect(s.score).toBeGreaterThanOrEqual(3);
    expect(s.state).toBe("watch");
  });

  test("needs enough history to say anything", () => {
    expect(scorePreMove({ points: points().slice(0, 4) }).state).toBe("quiet");
  });
});

describe("scorePreMove — call short-covering (2026-10-28 signature)", () => {
  test("arms when CE OI falls while the premium is bid", () => {
    const pts = points().map((p, i) =>
      i < 24
        ? p
        : {
            ...p,
            ce: p.ce - (i - 23) * 100_000,
            cePrem: p.cePrem + (i - 23) * 0.2,
          },
    );
    const s = scorePreMove({
      points: pts,
      rows: [],
      pressure: null,
      regime: { iv: 15, rv: 15 },
    });
    expect(s.components.some((c) => c.key === "call-cover")).toBe(true);
    expect(s.reasons).toContain("calls covered");
    expect(s.score).toBeGreaterThanOrEqual(4);
  });

  test("does not award covering when the premium also falls", () => {
    const pts = points().map((p, i) =>
      i < 24
        ? p
        : {
            ...p,
            ce: p.ce - (i - 23) * 100_000,
            cePrem: p.cePrem - (i - 23) * 2.0,
          },
    );
    const s = scorePreMove({
      points: pts,
      rows: [],
      pressure: null,
      regime: { iv: 15, rv: 15 },
    });
    expect(s.components.some((c) => c.key === "call-cover")).toBe(false);
  });
});

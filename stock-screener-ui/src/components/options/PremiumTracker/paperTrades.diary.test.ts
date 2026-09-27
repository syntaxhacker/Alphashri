// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadLesson,
  saveLesson,
  summarizeDay,
  uniqueDays,
  newPaperTrade,
  type PaperTrade,
} from "./paperTrades";

function makeTrade(overrides: Partial<PaperTrade> & { date: string }): PaperTrade {
  return {
    ...newPaperTrade({
      date: overrides.date,
      underlying: "NIFTY",
      side: "CE",
      strike: 23150,
      qty: 50,
      entry: 100,
      note: "",
    }),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("loadLesson / saveLesson", () => {
  it("round-trips lesson text through localStorage", () => {
    saveLesson("2026-09-28", "Cut losers fast");
    expect(loadLesson("2026-09-28")).toBe("Cut losers fast");
  });

  it("returns empty string when missing", () => {
    expect(loadLesson("2026-01-01")).toBe("");
  });

  it("returns empty string on corrupt storage", () => {
    localStorage.setItem("premium-lesson-2026-09-28", "not-json{{{");
    expect(loadLesson("2026-09-28")).toBe("");
  });

  it("keys lessons per date", () => {
    saveLesson("2026-09-27", "day one");
    saveLesson("2026-09-28", "day two");
    expect(loadLesson("2026-09-27")).toBe("day one");
    expect(loadLesson("2026-09-28")).toBe("day two");
  });
});

describe("uniqueDays", () => {
  it("returns sorted desc unique trade dates", () => {
    const trades = [
      makeTrade({ date: "2026-09-26" }),
      makeTrade({ date: "2026-09-28" }),
      makeTrade({ date: "2026-09-26" }),
      makeTrade({ date: "2026-09-27" }),
    ];
    expect(uniqueDays(trades)).toEqual(["2026-09-28", "2026-09-27", "2026-09-26"]);
  });

  it("returns empty array for no trades", () => {
    expect(uniqueDays([])).toEqual([]);
  });
});

describe("summarizeDay", () => {
  it("counts closed trades only for wins/total", () => {
    const trades = [
      makeTrade({ date: "2026-09-28", exit: 150 }), // +2500 win
      makeTrade({ date: "2026-09-28", exit: 80 }), // -1000 loss
      makeTrade({ date: "2026-09-28", exit: null }), // open, ignored for wins/total
      makeTrade({ date: "2026-09-27", exit: 200 }), // other day, ignored
    ];
    const summary = summarizeDay(trades, "2026-09-28");
    expect(summary).toEqual({ day: "2026-09-28", trades: 3, wins: 1, total: 1500 });
  });

  it("returns zeros for a day with no trades", () => {
    expect(summarizeDay([], "2026-09-28")).toEqual({
      day: "2026-09-28",
      trades: 0,
      wins: 0,
      total: 0,
    });
  });
});

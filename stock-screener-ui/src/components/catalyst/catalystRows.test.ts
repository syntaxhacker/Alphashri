// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  CATALYST_COLUMN_ALIGN,
  CATALYST_FILTERS,
  confirmationFacts,
  confirmationSortValue,
  confirmationText,
  confirmedCount,
  filterCatalystRows,
  formatIstClock,
  formatIstStamp,
  isSafeSourceUrl,
  isStale,
  rowSectorBreadth,
  scoreRank,
  sectorMatches,
  sortCatalystRows,
  warningLabels,
  type CatalystRowLike,
  type CatalystSectorView,
} from "./catalystRows";

function row(overrides: Partial<CatalystRowLike> & { symbol: string }): CatalystRowLike {
  return {
    name: overrides.symbol,
    sector: "Auto",
    kind: "news",
    headline: `${overrides.symbol} catalyst`,
    source: "Business Standard",
    source_url: "https://example.com/story",
    first_seen: "2026-11-19T10:00:00+05:30",
    state: "scheduled",
    score: "medium",
    move_pct: null,
    rel_volume: null,
    reasons: [],
    invalidates: [],
    ...overrides,
  };
}

const AUTO = `NIFTY AUTO`;

describe("catalyst filter options", () => {
  test("the toolbar offers all / high / sector / scheduled in order", () => {
    expect(CATALYST_FILTERS.map((option) => option.value)).toEqual([
      "all",
      "high",
      "sector",
      "scheduled",
    ]);
  });
});

describe("filterCatalystRows", () => {
  const rows = [
    row({ symbol: "MARUTI", score: "high", state: "confirmed", sector: "Auto" }),
    row({ symbol: "TCS", score: "medium", state: "scheduled", sector: "IT" }),
    row({ symbol: "M&M", score: "low", state: "fading", sector: "Auto" }),
  ];

  test("all returns the payload order untouched", () => {
    expect(filterCatalystRows(rows, "all").map((r) => r.symbol)).toEqual(["MARUTI", "TCS", "M&M"]);
  });

  test("high keeps only high scores", () => {
    expect(filterCatalystRows(rows, "high").map((r) => r.symbol)).toEqual(["MARUTI"]);
  });

  test("scheduled keeps only scheduled rows", () => {
    expect(filterCatalystRows(rows, "scheduled").map((r) => r.symbol)).toEqual(["TCS"]);
  });

  test("sector matches the payload sector label, not the row's case or index prefix", () => {
    expect(
      filterCatalystRows(rows, "sector", { sectorLabel: AUTO }).map((r) => r.symbol),
    ).toEqual(["MARUTI", "M&M"]);
  });

  test("sector also matches the sector id", () => {
    expect(
      filterCatalystRows(rows, "sector", { sectorId: "auto" }).map((r) => r.symbol),
    ).toEqual(["MARUTI", "M&M"]);
  });

  test("the market-wide sector keeps every row", () => {
    expect(filterCatalystRows(rows, "sector", { sectorId: "all" })).toEqual(rows);
  });

  test("sector without sector context is empty rather than everything", () => {
    expect(filterCatalystRows(rows, "sector")).toEqual([]);
  });
});

describe("sector matching", () => {
  test("ignores the NIFTY prefix and punctuation", () => {
    expect(sectorMatches("Auto", "NIFTY AUTO")).toBe(true);
    expect(sectorMatches("M&M", "NIFTY M&M")).toBe(true);
  });

  test("different sectors and empty inputs do not match", () => {
    expect(sectorMatches("IT", "NIFTY AUTO")).toBe(false);
    expect(sectorMatches("", AUTO)).toBe(false);
    expect(sectorMatches("Auto", null)).toBe(false);
  });
});

describe("rowSectorBreadth", () => {
  const sector: CatalystSectorView = {
    id: "auto",
    label: AUTO,
    breadth: { advancing: 12, declining: 3, total: 15 },
  };

  test("attaches breadth to rows in the payload sector", () => {
    expect(rowSectorBreadth(row({ symbol: "MARUTI" }), sector)).toEqual({
      advancing: 12,
      declining: 3,
      total: 15,
    });
  });

  test("never attaches another sector's breadth to a row", () => {
    expect(rowSectorBreadth(row({ symbol: "TCS", sector: "IT" }), sector)).toBeNull();
  });

  test("returns null when the payload has no breadth", () => {
    expect(rowSectorBreadth(row({ symbol: "MARUTI" }), { id: "auto", label: AUTO })).toBeNull();
  });
});

describe("sortCatalystRows", () => {
  test("scores high to low, then newest sighting first", () => {
    const rows = [
      row({ symbol: "OLD", score: "high", first_seen: "2026-11-19T09:30:00+05:30" }),
      row({ symbol: "LOW", score: "low", first_seen: "2026-11-19T11:00:00+05:30" }),
      row({ symbol: "NEW", score: "high", first_seen: "2026-11-19T10:45:00+05:30" }),
      row({ symbol: "MID", score: "medium", first_seen: "2026-11-19T10:00:00+05:30" }),
    ];

    expect(sortCatalystRows(rows).map((r) => r.symbol)).toEqual(["NEW", "OLD", "MID", "LOW"]);
  });

  test("a missing first_seen sorts last and does not disturb the rest", () => {
    const rows = [
      row({ symbol: "UNKNOWN", score: "high", first_seen: null }),
      row({ symbol: "KNOWN", score: "high", first_seen: "2026-11-19T10:00:00+05:30" }),
    ];

    expect(sortCatalystRows(rows).map((r) => r.symbol)).toEqual(["KNOWN", "UNKNOWN"]);
  });

  test("does not mutate the caller's array", () => {
    const rows = [
      row({ symbol: "A", score: "low" }),
      row({ symbol: "B", score: "high" }),
    ];
    const before = rows.map((r) => r.symbol);

    sortCatalystRows(rows);

    expect(rows.map((r) => r.symbol)).toEqual(before);
  });

  test("scoreRank treats unknown scores as lowest", () => {
    expect(scoreRank("high")).toBe(3);
    expect(scoreRank(undefined)).toBe(0);
    expect(scoreRank("nonsense")).toBe(0);
  });
});

describe("confirmedCount", () => {
  test("counts confirmed rows only", () => {
    const rows = [
      row({ symbol: "A", state: "confirmed" }),
      row({ symbol: "B", state: "breaking" }),
      row({ symbol: "C", state: "confirmed" }),
      row({ symbol: "D", state: null }),
    ];

    expect(confirmedCount(rows)).toBe(2);
    expect(confirmedCount([])).toBe(0);
  });
});

describe("confirmation", () => {
  const breadth = { advancing: 12, declining: 3, total: 15 };

  test("formats every measured confirmation and omits missing ones", () => {
    expect(confirmationFacts(row({ symbol: "A", move_pct: 6.5, rel_volume: 2.4 }), breadth)).toEqual({
      move: "+6.50%",
      volume: "2.4× vol",
      breadth: "12/15 adv",
    });
    expect(confirmationFacts(row({ symbol: "A", move_pct: -1.2 }))).toEqual({
      move: "-1.20%",
      volume: null,
      breadth: null,
    });
  });

  test("derives breadth from advancing + declining when total is absent", () => {
    expect(
      confirmationFacts(row({ symbol: "A" }), { advancing: 8, declining: 2 }).breadth,
    ).toBe("8/10 adv");
  });

  test("text joins present facts and says none when nothing is measured", () => {
    expect(confirmationText(row({ symbol: "A", move_pct: 6.5, rel_volume: 2.4 }), breadth)).toBe(
      "+6.50% · 2.4× vol · 12/15 adv",
    );
    expect(confirmationText(row({ symbol: "A" }))).toBe("none");
  });

  test("sorts by absolute move, then relative volume, otherwise null", () => {
    expect(confirmationSortValue(row({ symbol: "A", move_pct: -6.5 }))).toBe(6.5);
    expect(confirmationSortValue(row({ symbol: "A", rel_volume: 3.1 }))).toBe(3.1);
    expect(confirmationSortValue(row({ symbol: "A" }))).toBeNull();
  });
});

describe("time formatting", () => {
  test("renders the payload instant on the IST clock, not the host clock", () => {
    expect(formatIstClock("2026-11-19T05:43:00Z")).toBe("11:13");
  });

  test("invalid and missing values render a dash", () => {
    expect(formatIstClock(null)).toBe("—");
    expect(formatIstClock("not-a-date")).toBe("—");
  });

  test("stamp carries the IST date", () => {
    expect(formatIstStamp("2026-11-18T20:31:00Z")).toBe("19 Nov · 02:01");
  });
});

describe("isStale", () => {
  const now = Date.parse("2026-11-19T10:30:00+05:30");

  test("fresh payload is not stale", () => {
    expect(isStale("2026-11-19T10:29:00+05:30", now)).toBe(false);
  });

  test("exactly at the threshold is still fresh; one ms past is stale", () => {
    expect(isStale("2026-11-19T10:25:00+05:30", now)).toBe(false);
    expect(isStale("2026-11-19T10:24:59.999+05:30", now)).toBe(true);
  });

  test("unknown or future timestamps are not stale", () => {
    expect(isStale(null, now)).toBe(false);
    expect(isStale("nonsense", now)).toBe(false);
    expect(isStale("2026-11-19T11:00:00+05:30", now)).toBe(false);
  });
});

describe("warnings and links", () => {
  test("warning ids become readable labels", () => {
    expect(warningLabels(["event_source_unavailable", "", "ir-feed_down"])).toEqual([
      "EVENT SOURCE UNAVAILABLE",
      "IR FEED DOWN",
    ]);
  });

  test("only http(s) source links count as sources", () => {
    expect(isSafeSourceUrl("https://example.com/story")).toBe(true);
    expect(isSafeSourceUrl("http://example.com/story")).toBe(true);
    expect(isSafeSourceUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeSourceUrl("not a url")).toBe(false);
    expect(isSafeSourceUrl(null)).toBe(false);
  });
});

describe("column alignment contract", () => {
  test("every competitive column declares an explicit alignment", () => {
    expect(CATALYST_COLUMN_ALIGN).toEqual({
      symbol: "left",
      catalyst: "left",
      first_seen: "left",
      state: "center",
      confirmation: "right",
      score: "center",
    });
  });
});

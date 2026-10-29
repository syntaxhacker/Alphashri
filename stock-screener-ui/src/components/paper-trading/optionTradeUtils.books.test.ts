// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  BOOK_LABELS,
  bookKeyForSource,
  bookKeyForTrade,
  bookLabelForSource,
  listBookFilters,
  tradeMatchesBook,
} from "./optionTradeUtils";
import { mockTrade } from "./testFixtures";

describe("bookLabelForSource", () => {
  it("maps the options_paper* prefix to Options", () => {
    expect(bookLabelForSource("options_paper")).toBe("Options");
    expect(bookLabelForSource("options_paper_agent")).toBe("Options");
  });

  it("maps the futures_paper* prefix to Futures", () => {
    expect(bookLabelForSource("futures_paper")).toBe("Futures");
    expect(bookLabelForSource("futures_paper_bfo")).toBe("Futures");
  });

  it("maps the commodities_paper* prefix to Commodities", () => {
    expect(bookLabelForSource("commodities_paper")).toBe("Commodities");
    expect(bookLabelForSource("commodities_paper_gold")).toBe("Commodities");
  });

  it("maps live / unknown / missing sources to Equity", () => {
    expect(bookLabelForSource("live")).toBe("Equity");
    expect(bookLabelForSource("paper")).toBe("Equity");
    expect(bookLabelForSource("")).toBe("Equity");
    expect(bookLabelForSource(undefined)).toBe("Equity");
    expect(bookLabelForSource(null)).toBe("Equity");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(bookLabelForSource("OPTIONS_PAPER_AGENT")).toBe("Options");
    expect(bookLabelForSource("  futures_paper  ")).toBe("Futures");
  });
});

describe("bookKeyForSource", () => {
  it("returns the book key for each known prefix", () => {
    expect(bookKeyForSource("options_paper_agent")).toBe("options");
    expect(bookKeyForSource("futures_paper")).toBe("futures");
    expect(bookKeyForSource("commodities_paper")).toBe("commodities");
    expect(bookKeyForSource("live")).toBe("equity");
    expect(bookKeyForSource(undefined)).toBe("equity");
  });
});

describe("bookKeyForTrade", () => {
  it("keeps options wins (source-first) over the source prefix", () => {
    expect(bookKeyForTrade({ symbol: "RELIANCE", source: "options_paper" })).toBe("options");
  });

  it("falls back to the symbol when the source is missing", () => {
    expect(bookKeyForTrade({ symbol: "NIFTY26OCT23000PE" })).toBe("options");
    expect(bookKeyForTrade({ symbol: "RELIANCE" })).toBe("equity");
  });

  it("uses the source prefix for the other books", () => {
    expect(bookKeyForTrade({ symbol: "NIFTY", source: "futures_paper" })).toBe("futures");
    expect(bookKeyForTrade({ symbol: "XAU", source: "commodities_paper" })).toBe("commodities");
    expect(bookKeyForTrade({ symbol: "RELIANCE", source: "live" })).toBe("equity");
  });
});

describe("tradeMatchesBook", () => {
  const option = mockTrade({ trade_id: "o1", symbol: "NIFTY 2026-10-19 22900CE", source: "options_paper" });
  const future = mockTrade({ trade_id: "f1", symbol: "NIFTY", source: "futures_paper" });
  const equity = mockTrade({ trade_id: "e1" });

  it("matches each trade to exactly one book", () => {
    for (const trade of [option, future, equity]) {
      const matches = (["equity", "options", "futures", "commodities"] as const).filter((b) =>
        tradeMatchesBook(trade, b),
      );
      expect(matches.length).toBe(1);
    }
  });

  it("assigns the option trade to options and the rest accordingly", () => {
    expect(tradeMatchesBook(option, "options")).toBe(true);
    expect(tradeMatchesBook(option, "equity")).toBe(false);
    expect(tradeMatchesBook(future, "futures")).toBe(true);
    expect(tradeMatchesBook(future, "equity")).toBe(false);
    expect(tradeMatchesBook(equity, "equity")).toBe(true);
  });
});

describe("listBookFilters", () => {
  it("always offers All, Equity and Options", () => {
    expect(listBookFilters([])).toEqual([
      { value: "all", label: "All" },
      { value: "equity", label: "Equity" },
      { value: "options", label: "Options" },
    ]);
  });

  it("adds Futures when a futures trade is present", () => {
    const filters = listBookFilters([
      mockTrade({ trade_id: "e1" }),
      mockTrade({ trade_id: "f1", source: "futures_paper" }),
    ]);
    expect(filters.map((f) => f.value)).toEqual(["all", "equity", "options", "futures"]);
    expect(filters.map((f) => f.label)).toEqual(["All", "Equity", "Options", "Futures"]);
  });

  it("adds Commodities when a commodities trade is present", () => {
    const filters = listBookFilters([
      mockTrade({ trade_id: "c1", source: "commodities_paper_gold" }),
    ]);
    expect(filters.map((f) => f.value)).toEqual(["all", "equity", "options", "commodities"]);
  });

  it("does not offer books that are absent from the data", () => {
    const filters = listBookFilters([mockTrade({ trade_id: "o1", source: "options_paper_agent" })]);
    expect(filters.map((f) => f.value)).toEqual(["all", "equity", "options"]);
  });

  it("keeps the canonical book order for every book", () => {
    const filters = listBookFilters([
      mockTrade({ trade_id: "c1", source: "commodities_paper" }),
      mockTrade({ trade_id: "f1", source: "futures_paper" }),
      mockTrade({ trade_id: "o1", source: "options_paper" }),
    ]);
    expect(filters.map((f) => f.value)).toEqual([
      "all",
      "equity",
      "options",
      "futures",
      "commodities",
    ]);
  });

  it("tolerates an empty / missing trade list", () => {
    expect(listBookFilters(null)).toHaveLength(3);
    expect(listBookFilters(undefined)).toHaveLength(3);
  });

  it("exposes a label for every book key", () => {
    expect(BOOK_LABELS.equity).toBe("Equity");
    expect(BOOK_LABELS.options).toBe("Options");
    expect(BOOK_LABELS.futures).toBe("Futures");
    expect(BOOK_LABELS.commodities).toBe("Commodities");
  });
});

import { describe, expect, test } from "vitest";
import {
  displaySymbol,
  isIndianIndex,
  normalizeSymbol,
  stripExchange,
  tickerLabelForFeedSymbol,
  tradingViewChartUrl,
  tradingViewSymbol,
} from "./tvSymbols";

describe("symbol normalizer", () => {
  test("stripExchange removes a known TV prefix and keeps ticker casing", () => {
    expect(stripExchange("NSE:RELIANCE")).toBe("RELIANCE");
    expect(stripExchange("bse:tata")).toBe("tata");
    expect(stripExchange("NASDAQ:AAPL")).toBe("AAPL");
  });

  test("stripExchange removes a Yahoo suffix but preserves US share-class dots", () => {
    expect(stripExchange("RELIANCE.NS")).toBe("RELIANCE");
    expect(stripExchange("TATA.BO")).toBe("TATA");
    expect(stripExchange("BRK.B")).toBe("BRK.B");
  });

  test("displaySymbol returns a clean, trimmed label", () => {
    expect(displaySymbol("  NSE:RELIANCE  ")).toBe("RELIANCE");
    expect(displaySymbol("RELIANCE.NS")).toBe("RELIANCE");
    expect(displaySymbol("BRK.B")).toBe("BRK.B");
    expect(displaySymbol("")).toBe("");
  });

  test("normalizeSymbol is an uppercase, exchange-free identity key", () => {
    expect(normalizeSymbol("NSE:reliance")).toBe("RELIANCE");
    expect(normalizeSymbol("RELIANCE.NS")).toBe("RELIANCE");
    expect(normalizeSymbol("BSE:TATA")).toBe("TATA");
  });
});

describe("tradingViewSymbol", () => {
  test("uses NSE for normal stocks", () => {
    expect(tradingViewSymbol("RELIANCE")).toBe("NSE:RELIANCE");
    expect(tradingViewSymbol("ircon")).toBe("NSE:IRCON");
  });

  test("maps Indian indices to their TradingView symbols", () => {
    expect(tradingViewSymbol("NIFTY")).toBe("NSE:NIFTY");
    expect(tradingViewSymbol("BANKNIFTY")).toBe("NSE:BANKNIFTY");
    expect(tradingViewSymbol("FINNIFTY")).toBe("NSE:CNXFINANCE");
    expect(tradingViewSymbol("MIDCPNIFTY")).toBe("NSE:NIFTY_MID_SELECT");
    expect(tradingViewSymbol("NIFTYIT")).toBe("NSE:CNXIT");
    expect(tradingViewSymbol("NIFTY100")).toBe("NSE:CNX100");
    expect(tradingViewSymbol("SENSEX")).toBe("BSE:SENSEX");
    expect(tradingViewSymbol("BANKEX")).toBe("BSE:BANK");
  });

  test("honours an explicit market for non-Indian listings", () => {
    expect(tradingViewSymbol("AAPL", "NASDAQ")).toBe("NASDAQ:AAPL");
    expect(tradingViewSymbol("SAP", "XETRA")).toBe("XETRA:SAP");
    // Index aliases win over the market hint.
    expect(tradingViewSymbol("NIFTY", "NASDAQ")).toBe("NSE:NIFTY");
    expect(tradingViewSymbol("", "NASDAQ")).toBe("");
  });

  test("does not double-prefix an already exchange-qualified symbol", () => {
    expect(tradingViewSymbol("NSE:RELIANCE")).toBe("NSE:RELIANCE");
    expect(tradingViewSymbol("BSE:TATA")).toBe("BSE:TATA");
    expect(tradingViewSymbol("NASDAQ:AAPL")).toBe("NASDAQ:AAPL");
  });

  test("converts Yahoo suffixes to the matching TV exchange", () => {
    expect(tradingViewSymbol("RELIANCE.NS")).toBe("NSE:RELIANCE");
    expect(tradingViewSymbol("TATA.BO")).toBe("BSE:TATA");
  });

  test("keeps index aliases stable when the input carries an exchange", () => {
    expect(tradingViewSymbol("SENSEX")).toBe("BSE:SENSEX");
    expect(tradingViewSymbol("BSE:SENSEX")).toBe("BSE:SENSEX");
    expect(tradingViewSymbol("FINNIFTY")).toBe("NSE:CNXFINANCE");
    expect(tradingViewSymbol("NSE:FINNIFTY")).toBe("NSE:CNXFINANCE");
  });
});

describe("isIndianIndex", () => {
  test("recognizes the configured index universe only", () => {
    expect(isIndianIndex("NIFTY")).toBe(true);
    expect(isIndianIndex("niftyit")).toBe(true);
    expect(isIndianIndex("NIFTYCEMENT")).toBe(true);
    expect(isIndianIndex("INDIAVIX")).toBe(true);
    expect(isIndianIndex("RELIANCE")).toBe(false);
    expect(isIndianIndex("")).toBe(false);
  });

  test("recognizes prefixed and suffixed index symbols", () => {
    expect(isIndianIndex("NSE:NIFTY")).toBe(true);
    expect(isIndianIndex("BSE:SENSEX")).toBe(true);
    expect(isIndianIndex("SENSEX.BO")).toBe(true);
  });
});

describe("tradingViewChartUrl", () => {
  test("builds an encoded TradingView chart URL", () => {
    expect(tradingViewChartUrl("RELIANCE")).toBe(
      "https://www.tradingview.com/chart/?symbol=NSE%3ARELIANCE",
    );
    expect(tradingViewChartUrl("SENSEX")).toBe(
      "https://www.tradingview.com/chart/?symbol=BSE%3ASENSEX",
    );
    expect(tradingViewChartUrl("NSE:RELIANCE")).toBe(
      "https://www.tradingview.com/chart/?symbol=NSE%3ARELIANCE",
    );
  });

  test("returns an empty URL for an empty symbol", () => {
    expect(tradingViewChartUrl("")).toBe("");
  });
});

describe("tickerLabelForFeedSymbol", () => {
  test("maps canonical feed keys to canonical labels", () => {
    expect(tickerLabelForFeedSymbol("^NSEI")).toBe("NIFTY");
    expect(tickerLabelForFeedSymbol("^NSEBANK")).toBe("BANKNIFTY");
    expect(tickerLabelForFeedSymbol("GC=F")).toBe("Gold");
  });

  test("maps prose feed aliases to canonical labels instead of leaking the key", () => {
    // The E2E mock (tests/mocks/apiResponses.ts) sends prose keys in the `tickers`
    // map. The fallback `?? key` used to render "NIFTY 50" verbatim.
    expect(tickerLabelForFeedSymbol("NIFTY 50")).toBe("NIFTY");
    expect(tickerLabelForFeedSymbol("Nifty 50")).toBe("NIFTY");
    expect(tickerLabelForFeedSymbol("NIFTY BANK")).toBe("BANKNIFTY");
    expect(tickerLabelForFeedSymbol("Bank Nifty")).toBe("BANKNIFTY");
    expect(tickerLabelForFeedSymbol(" bank nifty ")).toBe("BANKNIFTY");
  });

  test("keeps unknown keys as their own label", () => {
    expect(tickerLabelForFeedSymbol("UNKNOWN")).toBe("UNKNOWN");
    expect(tickerLabelForFeedSymbol("")).toBe("");
  });
});

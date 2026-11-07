import { describe, expect, test } from "vitest";
import { isIndianIndex, tradingViewChartUrl, tradingViewSymbol } from "./tvSymbols";

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
});

describe("tradingViewChartUrl", () => {
  test("builds an encoded TradingView chart URL", () => {
    expect(tradingViewChartUrl("RELIANCE")).toBe(
      "https://www.tradingview.com/chart/?symbol=NSE%3ARELIANCE",
    );
    expect(tradingViewChartUrl("SENSEX")).toBe(
      "https://www.tradingview.com/chart/?symbol=BSE%3ASENSEX",
    );
  });

  test("returns an empty URL for an empty symbol", () => {
    expect(tradingViewChartUrl("")).toBe("");
  });
});

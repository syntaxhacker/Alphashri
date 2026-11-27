const INDEX_TV_SYMBOLS: Record<string, string> = {
  NIFTY: "NSE:NIFTY",
  BANKNIFTY: "NSE:BANKNIFTY",
  FINNIFTY: "NSE:CNXFINANCE",
  MIDCPNIFTY: "NSE:NIFTY_MID_SELECT",
  NIFTYNXT50: "NSE:NIFTYJR",
  NIFTY100: "NSE:CNX100",
  NIFTY200: "NSE:CNX200",
  NIFTY500: "NSE:CNX500",
  NIFTYMIDCAP50: "NSE:NIFTYMIDCAP50",
  NIFTYMIDCAP100: "NSE:CNXMIDCAP",
  NIFTYMIDCAP150: "NSE:NIFTYMIDCAP150",
  NIFTYSMLCAP50: "NSE:NIFTYSMLCAP50",
  NIFTYSMLCAP100: "NSE:CNXSMALLCAP",
  NIFTYSMLCAP250: "NSE:NIFTYSMLCAP250",
  NIFTYTOTALMKT: "NSE:NIFTY_TOTAL_MKT",
  SENSEX: "BSE:SENSEX",
  BANKEX: "BSE:BANK",
  NIFTYIT: "NSE:CNXIT",
  NIFTYAUTO: "NSE:CNXAUTO",
  NIFTYPHARMA: "NSE:CNXPHARMA",
  NIFTYFMCG: "NSE:CNXFMCG",
  NIFTYMETAL: "NSE:CNXMETAL",
  NIFTYENERGY: "NSE:CNXENERGY",
  NIFTYPSUBANK: "NSE:CNXPSUBANK",
  NIFTYPVTBANK: "NSE:NIFTYPVTBANK",
  NIFTYREALTY: "NSE:CNXREALTY",
  NIFTYMEDIA: "NSE:CNXMEDIA",
  NIFTYINFRA: "NSE:CNXINFRA",
  NIFTYCOMMODITIES: "NSE:CNXCOMMODITIES",
  NIFTYCPSE: "NSE:CPSE",
  NIFTYPSE: "NSE:CNXPSE",
  NIFTYSERV: "NSE:CNXSERVICE",
  NIFTYCEMENT: "NSE:NIFTY_CEMENT",
  NIFTYCHEMICALS: "NSE:NIFTY_CHEMICALS",
  NIFTYCONSUMPTION: "NSE:CNXCONSUMPTION",
  NIFTYOILGAS: "NSE:NIFTY_OIL_AND_GAS",
  NIFTYDEFENCE: "NSE:NIFTY_IND_DEFENCE",
  NIFTYDIGITAL: "NSE:NIFTY_IND_DIGITAL",
  NIFTYMFG: "NSE:NIFTY_INDIA_MFG",
  NIFTYHOUSING: "NSE:NIFTY_HOUSING",
  NIFTYCAPMKT: "NSE:NIFTY_CAPITAL_MKT",
  NIFTYMOBILITY: "NSE:NIFTY_MOBILITY",
  NIFTYEV: "NSE:NIFTY_EV",
  NIFTYINTERNET: "NSE:NIFTY_INTERNET",
  NIFTYMNC: "NSE:CNXMNC",
  NIFTYRURAL: "NSE:NIFTY_RURAL",
  NIFTYRAILWAYS: "NSE:NIFTY_RAILWAYSPSU",
  NIFTYTRANSLOG: "NSE:NIFTY_TRANS_LOGIS",
  NIFTYCONSDUR: "NSE:NIFTY_CONSR_DURBL",
  NIFTYNEWCONS: "NSE:NIFTY_NEW_CONSUMP",
  NIFTYNONCYC: "NSE:NIFTY_NONCYC_CONS",
  INDIAVIX: "NSE:INDIAVIX",
};

/**
 * Exchanges that may decorate a feed symbol. `yahooSuffix` is the matching
 * Yahoo Finance suffix; keeping both in one table stops the chart, dock and
 * CSV helpers from growing separate prefix rules.
 */
interface ExchangeRule {
  tv: string;
  yahooSuffix?: string;
}

const EXCHANGE_RULES: readonly ExchangeRule[] = [
  { tv: "NSE", yahooSuffix: ".NS" },
  { tv: "BSE", yahooSuffix: ".BO" },
  { tv: "NASDAQ" },
  { tv: "NYSE" },
  { tv: "AMEX" },
  { tv: "XETRA" },
  { tv: "LSE" },
  { tv: "TSE" },
  { tv: "HKEX" },
  { tv: "SGX" },
  { tv: "CME" },
  { tv: "NYMEX" },
  { tv: "COMEX" },
  { tv: "CBOT" },
  { tv: "FOREX" },
  { tv: "OTC" },
];

const PREFIX_EXCHANGES = new Map(EXCHANGE_RULES.map((rule) => [rule.tv, rule.tv]));
const SUFFIX_EXCHANGES = new Map(
  EXCHANGE_RULES.filter((rule) => rule.yahooSuffix).map((rule) => [
    rule.yahooSuffix as string,
    rule.tv,
  ]),
);

interface ParsedSymbol {
  /** Exchange tag carried by the raw input, or null when undecorated. */
  exchange: string | null;
  /** Bare ticker with original casing; internal dots such as `BRK.B` survive. */
  ticker: string;
}

function parseSymbol(symbol: string): ParsedSymbol {
  const raw = String(symbol ?? "").trim();
  if (!raw) return { exchange: null, ticker: "" };

  const colon = raw.indexOf(":");
  if (colon > 0) {
    const exchange = PREFIX_EXCHANGES.get(raw.slice(0, colon).toUpperCase());
    if (exchange) return { exchange, ticker: raw.slice(colon + 1).trim() };
  }

  // Only known venue suffixes count as decoration; `BRK.B` keeps its dot.
  const dot = raw.lastIndexOf(".");
  if (dot > 0) {
    const exchange = SUFFIX_EXCHANGES.get(raw.slice(dot).toUpperCase());
    if (exchange) return { exchange, ticker: raw.slice(0, dot).trim() };
  }

  return { exchange: null, ticker: raw };
}

/** Remove a known TV exchange prefix or Yahoo suffix; keep the bare ticker. */
export function stripExchange(symbol: string): string {
  return parseSymbol(symbol).ticker;
}

/** Clean label for tables/links: exchange decoration removed, casing kept. */
export function displaySymbol(symbol: string): string {
  const raw = String(symbol ?? "").trim();
  return stripExchange(raw) || raw;
}

/** Canonical identity key: bare ticker, uppercase, free of exchange tags. */
export function normalizeSymbol(symbol: string): string {
  return stripExchange(symbol).toUpperCase();
}

export function isIndianIndex(symbol: string): boolean {
  return Object.prototype.hasOwnProperty.call(INDEX_TV_SYMBOLS, normalizeSymbol(symbol));
}

export function tradingViewSymbol(symbol: string, market?: string): string {
  const { exchange, ticker } = parseSymbol(symbol);
  const key = ticker.toUpperCase();
  if (!key) return "";
  const index = INDEX_TV_SYMBOLS[key];
  if (index) return index;
  // The input's own exchange wins over the surface's market hint; an
  // undecorated ticker falls back to NSE for the default equity screens.
  const hint = String(market ?? "").trim().toUpperCase();
  return `${exchange ?? (hint || "NSE")}:${key}`;
}

export function tradingViewChartUrl(symbol: string, market?: string): string {
  const tv = tradingViewSymbol(symbol, market);
  return tv ? `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tv)}` : "";
}

/**
 * Market-tape feed key → canonical display label. The feed key stays the API
 * identity (sort order, request payload, test ids); only the visible label is
 * canonicalised so `^NSEI` reads `NIFTY`, never the prose "Nifty 50".
 */
export const TICKER_FEED_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "^NSEI": "NIFTY",
  "^NSEBANK": "BANKNIFTY",
  "GC=F": "Gold",
  "SI=F": "Silver",
  "CL=F": "Crude Oil",
  "USDINR=X": "USD/INR",
});

/**
 * Prose aliases some feeds send as the ticker *key* (not the `name` field).
 * Without this map the `?? key` fallback renders "NIFTY 50" verbatim next to
 * the canonicalised ^NSEI tile. Keys are matched case- and space-insensitively.
 */
const TICKER_FEED_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "NIFTY 50": "^NSEI",
  "NIFTY BANK": "^NSEBANK",
  "BANK NIFTY": "^NSEBANK",
});

/** Canonical label for a tape feed symbol; unknown keys keep their feed key. */
export function tickerLabelForFeedSymbol(feedSymbol: string): string {
  const raw = String(feedSymbol ?? "").trim();
  const key = raw.replace(/\s+/g, " ").toUpperCase();
  return TICKER_FEED_LABELS[TICKER_FEED_ALIASES[key] ?? key] ?? raw;
}

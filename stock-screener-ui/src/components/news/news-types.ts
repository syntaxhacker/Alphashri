/**
 * Stock symbol mentioned in an article
 */
export interface NewsSymbol {
  name: string;
  code: string;
  url: string;
  trading_symbol?: string;
  instrument_key?: string;
  company_name?: string;
  match_confidence?: number;
  match_method?: "exact" | "variation" | "fuzzy" | "none" | "blacklisted";
}

/**
 * News item interface - represents a single news article
 */
export interface NewsItem {
  id: string;
  headline: string;
  description: string;
  source: string;
  sourceUrl: string;
  publishedAt: string;
  fetchedAt: string;
  symbols?: NewsSymbol[];
}

/**
 * News source configuration
 */
export interface NewsSource {
  id: string;
  name: string;
  url: string;
}

/**
 * News API response
 */
export interface NewsResponse {
  items: NewsItem[];
  source: string;
  total: number;
  fetchedAt: string;
}

/**
 * Trade idea from LLM analysis
 */
export interface TradeIdea {
  symbol: string;
  direction: "LONG" | "SHORT";
  reasoning: string;
}

/**
 * Article content response
 */
export interface ArticleResponse extends NewsItem {
  error?: string;
  sentiment?: "BULLISH" | "BEARISH" | "NEUTRAL";
  impact_score?: number;
  summary?: string;
  key_points?: string[];
  key_entities?: string[];
  trade_ideas?: TradeIdea[];
  analysis_status?: "none" | "pending" | "processing" | "done" | "failed";
}

/**
 * Symbol mapping result
 */
export interface SymbolMapping {
  original_code: string;
  trading_symbol: string | null;
  instrument_key: string | null;
  company_name: string | null;
  confidence: number;
  method: string;
}

/**
 * Chart data for a symbol
 */
export interface SymbolChartData {
  symbol: string;
  trading_symbol: string;
  instrument_key: string;
  company_name: string;
  match_confidence: number;
  match_method: string;
  from_date: string;
  to_date: string;
  candles: Array<[string, number, number, number, number, number, number]>;
  candle_format: string[];
  news_count: number;
  recent_news: NewsArticle[];
}

/**
 * Stored news article from database
 */
export interface NewsArticle {
  id: number;
  url: string;
  headline: string;
  content: string;
  source: string;
  source_url?: string;
  published_at?: string;
  fetched_at: string;
  sentiment?: string;
  impact_score?: number;
  summary?: string;
  key_points?: string[];
  key_entities?: string[];
  trade_ideas?: TradeIdea[];
  symbols?: NewsSymbol[];
  analysis_status?: "none" | "pending" | "processing" | "done" | "failed";
}

/**
 * News articles for symbol response
 */
export interface SymbolArticlesResponse {
  symbol: string;
  trading_symbol: string | null;
  instrument_key: string | null;
  is_mapped: boolean;
  total: number;
  articles: NewsArticle[];
}

/**
 * News stats response
 */
export interface NewsStatsResponse {
  total_articles: number;
  total_symbol_mentions: number;
  mapped_symbols: number;
  unmapped_symbols: number;
  sources: string[];
  mapper_stats: {
    total_instruments: number;
    eq_instruments: number;
    company_names_indexed: number;
    fuzzy_threshold: number;
    known_variations: number;
  };
}

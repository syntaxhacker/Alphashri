# Strategy Performance Summary

> Generated: 2026-06-26 | 6-month backtest (Jan–Jun 2026)
> All results WITH costs (brokerage/STT/exchange)

## Quick Rankings

| Rank | Bot | Strategy | Universe | **PF** | Net P&L | WR |
|------|-----|----------|----------|--------|---------|-----|
| 🥇 | **13** | **Volume Surge** | **trending** | **6.65** | **+₹442K** | **79%** |
| 🥇 | **12** | **Volume Surge** | **buyer_interest** | **6.41** | **+₹188K** | **72%** |
| 🥈 | **8** | **ADX Trend** | **trending** | **4.22** | **+₹480K** | **77%** |
| 🥉 | **7** | **ADX Trend** | TV screener 43 | **2.81** | **+₹510K** | **68%** |
| 4 | **6** | **EMA 60-min** | TV screener 43 | **2.47** | **+₹1.29M** | **63%** |
| 5 | **9** | **ADX Trend** | volatility_trend | **2.40** | **+₹339K** | **67%** |
| 6 | **10** | **ADX Trend** | high_momentum | **2.35** | **+₹332K** | **65%** |
| 7 | **11** | **EMA 60-min** | trending | **2.24** | **+₹921K** | **60%** |
| 8 | **5** | **ORB** | volatility_trend | **1.90** | **+₹125K** | **56%** |

## By Strategy Type

### Volume Surge (swing) — Best for strong buying days
| Bot | Universe | PF | Net | WR | Trades | SL/TP |
|-----|----------|-----|-----|-----|--------|-------|
| 13 | trending (ultra-large) | **6.65** | +₹442K | 79% | 73 | 8/10 |
| 12 | buyer_interest (mid) | **6.41** | +₹188K | 72% | 25 | 8/10 |

### ADX Trend (swing) — Best for trending markets
| Bot | Universe | PF | Net | WR | Trades | SL/TP |
|-----|----------|-----|-----|-----|--------|-------|
| 8 | trending | **4.22** | +₹480K | 77% | 105 | 5/6 |
| 7 | TV screener 43 | 2.81 | +₹510K | 68% | 159 | 5/6 |
| 9 | volatility_trend | 2.40 | +₹339K | 67% | 97 | 5/6 |
| 10 | high_momentum | 2.35 | +₹332K | 65% | 116 | 5/6 |

### EMA Cross 60-min (intraday) — Best for trending days
| Bot | Universe | PF | Net | WR | Trades | SL/TP |
|-----|----------|-----|-----|-----|--------|-------|
| 6 | TV screener 43 | **2.47** | +₹1.29M | 63% | 292 | 8/12 |
| 11 | trending | 2.24 | +₹921K | 60% | 235 | 8/12 |

### ORB (intraday) — Best for volatile breakouts
| Bot | Universe | PF | Net | WR | Trades | SL/TP |
|-----|----------|-----|-----|-----|--------|-------|
| 5 | volatility_trend | **1.90** | +₹125K | 56% | 291 | 1.2/2.0 |

## Key Insights

1. **Volume Surge** has the highest PF of any strategy (6.65) — very selective, high conviction.
2. **ADX Trend + trending** (ultra-large caps) combines high PF (4.22) with good trade count (105).
3. **EMA Cross 60-min** gives the highest absolute return (+₹1.29M) due to frequent, consistent trading.
4. **ORB** has the lowest PF (1.90) but is the most tested strategy (original autoresearch winner).
5. **Costs eat ~20% of gross PnL** on intraday strategies, but only ~3% on swing strategies.

## Universe Comparison (ADX Trend on different profiles)

| Profile | Universe | PF | Net | WR | Best For |
|---------|----------|-----|-----|-----|----------|
| trending | Ultra-large caps (₹5KCr+) | **4.22** | +₹480K | 77% | ✅ Trend following |
| volatility_trend | High ATR mid-caps | 2.40 | +₹339K | 67% | ⚠️ Volatile trends |
| high_momentum | Momentum stocks | 2.35 | +₹332K | 65% | ⚠️ Momentum |

## Drawdown Notes

- **EMA Cross 60-min**: Lost -₹173K in Jan 2026 (bear market). JUNIORBEES range≥1% filter fixed this.
- **ADX Trend**: Lost -₹120K in Jan and -₹122K in Mar 2026 (bear months). No filter found to fix these.
- **Volume Surge**: 0 trades in Jan-Mar 2026 (no buying volume during bear). Naturally avoids bad months.
- **ORB**: Profitable all 5 months (intraday nature — no multi-day risk).

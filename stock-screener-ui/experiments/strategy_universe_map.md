# Strategy ↔ Universe Mapping

Each strategy works best on a specific type of stock. The TV screener provides
different profiles to source these universes.

## Available Stock Universes

| Profile | Universe | Size | Filter | Best For |
|---------|----------|------|--------|----------|
| `trending` | Ultra-large cap trending | ~150 | MktCap>₹5KCr, price>MA20>MA50, ADX>20, RSI>50, ROE>10% | **ADX Trend**, **52W Chaser** |
| `volatility_trend` | High ATR trending stocks | ~150 | ATR%>2.5%, trending, volume surge | **ORB**, **EMA Cross** |
| `high_momentum` | Momentum stocks | ~200 | RSI 50-80, MACD rising, vol>500K | **ADX Trend**, **Momentum** |
| `near_52w_breakout` | Stocks near 52W high | ~100 | RSI 45-85, price>MA50>MA200, vol>1M | **52W Chaser**, **52W Target** |
| `52w_high` | All stocks with 52W data | ~500+ | Any cap | **52W Target**, **Blind 52W** |
| `rsi_reversal` | Oversold/overbought | ~50 | RSI<35 or RSI>65, StochK confirmation | **Mean Reversion** |
| `intraday_momentum` | Rapid intraday movers | ~100 | Recent 5-30min price runs | **Scalping**, **ORB** |
| `nifty_movers` | Nifty impact movers | ~50 | Market-cap weighted impact | **Large-cap trend** |
| `buyer_interest` | Buyer pressure | ~150 | Wick close >60%, volume surge | **Breakout**, **Momentum** |

## Strategy → Best Universe

| Strategy | Best Profile | Avg Trades/mo | Expected PF |
|----------|-------------|---------------|-------------|
| **ORB** (intraday) | `volatility_trend` | ~60 | ~1.90 |
| **ORB** (intraday) | `buyer_interest` | ~40 | ~1.50 (speculative) |
| **EMA Cross 60-min** | `volatility_trend` | ~50 | ~2.47 |
| **EMA Cross 60-min** | `trending` | ~30 | ~1.80 (speculative) |
| **ADX Trend** (swing) | `trending` | ~25 | ~2.81 |
| **ADX Trend** (swing) | `high_momentum` | ~20 | ~2.00 (speculative) |
| **52W Chaser** (swing) | `near_52w_breakout` | ~15 | ~1.50 |
| **52W Target** (swing) | `52w_high` | ~10 | ~1.30 |
| **Short 52W Failed** (swing) | `rsi_reversal` (bearish) | ~5 | ~0.50 (needs bear market) |

## How to Run a New Universe

```bash
# 1. Get symbols from a screener profile
python3 -c "
import sys; sys.path.insert(0, '.')
from orb_stock_screener import ORBStockScreener
s = ORBStockScreener(use_relaxed=True)
df = s.screen(profile='trending', limit=50, verify_nse=True)
print(df['name'].tolist())
"

# 2. Run benchmark with those symbols
# (modify SYMBOLS in the benchmark script)

# 3. Create a bot with the strategy + universe
# (set custom_watchlist to the symbols)
```

## Created Bots

| Bot | Name | Strategy | Universe | PF (6mo) | Net |
|-----|------|----------|----------|----------|------|
| 5 | ORB High Beta Bot | ORB | `volatility_trend` | 1.90 | +₹125K |
| 6 | EMA Cross Best Bot | EMA Cross 60-min | `volatility_trend` (TV) | 2.47 | +₹1.29M |
| 7 | ADX Trend Bot | ADX Trend | TV screener (43 stocks) | 2.81 | +₹510K |
| **8** | **ADX Trend Ultra-Large Bot** | **ADX Trend** | **`trending`** | **4.22** | **+₹480K** |
| **9** | **ADX Trend Volatility Bot** | **ADX Trend** | **`volatility_trend`** | **2.40** | **+₹339K** |
| **10** | **ADX Trend Momentum Bot** | **ADX Trend** | **`high_momentum`** | **2.35** | **+₹332K** |

## Pending Experiments

| # | Universe | Strategy | Status |
|---|----------|----------|--------|
| 1 | `trending` | EMA Cross 60-min | Not yet — could be strong |
| 2 | `rsi_reversal` | Mean Reversion | Signal gen needed |
| 3 | `intraday_momentum` | Scalping | Signal gen needed |
| 4 | `near_52w_breakout` | ADX Trend | Not yet — speculative |

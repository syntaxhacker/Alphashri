# yfinance tickers & CME sessions — reference

## Tickers

- Futures: `ES=F`, `NQ=F`, `YM=F` (Dow), `RTY=F` (Russell), `GC=F`, `CL=F` — `=F` suffix.
- Index: `^GSPC`, `^NDX`, `^RUT`, `^DJI`
- ETFs: `SPY`, `QQQ`, `IWM`, `DIA` — proxies for smoother backtests.

Verify: `yf.Ticker("ES=F").info["symbol"] == "ES=F"` and `yf.download("ES=F", period="5d", interval="1h")` returns UTC bars.

## CME Globex timing

- Globex open Sun 18:00 ET → Fri 17:00 ET, daily maintenance 17:00-18:00 ET (no bars).
- RTH 09:30-16:00 ET (NYSE). RTH volume ≈ 65-70% of day; overnight ≈ 30-35%.

## Session thresholds (from this EDA, Aug 2026, ES/NQ 1h)

- NY RTH avg daily range ≈ 0.6-1.0% (ES), 0.8-1.3% (NQ). Overnight ≈ 0.4-0.7% (ES), 0.6-1.0% (NQ).
- Europe contributes ~20-25% of overnight volume; Asia ~40-50% but thinner per hour.
- ES/NQ corr typically 0.88-0.94 (this week: see summary.json).
- ES/NQ beta (ES|NQ) ≈ 0.55-0.65 — NQ moves ~1.5-1.8× ES.

## Code patterns

```python
# always flatten
if isinstance(df.columns, pd.MultiIndex):
    df.columns = df.columns.get_level_values(0)
# always normalize tz
if df.index.tz is None:
    df.index = df.index.tz_localize("UTC")
else:
    df.index = df.index.tz_convert("UTC")
# then convert to ET for sessions
df["et"] = df.index.map(lambda ts: ts.tz_convert("America/New_York"))
```

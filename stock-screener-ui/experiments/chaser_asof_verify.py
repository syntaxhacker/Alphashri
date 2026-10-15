"""Independent hand-verification of 2 symbols from RAW candles.

Independent path: UpstoxAPI.fetch_historical_data_v3 directly (not the
market_data wrapper), plain-Python 52W max, hand-rolled Wilder ADX/RSI
(not trading.indicators), plain rolling means. Compares against
experiments/chaser_asof.json rows.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

FREEZE = "2026-10-01"
FROM = "2024-06-01"
TARGETS = ["WELSPUNLIV", "LGEINDIA"]


def wilder_rsi(close, period=14):
    import pandas as pd
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss
    return 100 - 100 / (1 + rs)


def wilder_adx(high, low, close, period=14):
    import pandas as pd
    up = high.diff()
    dn = -low.diff()
    plus_dm = ((up > dn) & (up > 0)).astype(float) * up
    minus_dm = ((dn > up) & (dn > 0)).astype(float) * dn
    tr = pd.concat([high - low, (high - close.shift()).abs(),
                    (low - close.shift()).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    plus_di = 100 * plus_dm.ewm(alpha=1 / period, min_periods=period, adjust=False).mean() / atr
    minus_di = 100 * minus_dm.ewm(alpha=1 / period, min_periods=period, adjust=False).mean() / atr
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di)
    return dx.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()


def main():
    import json
    import pandas as pd
    from backtest.utils import get_upstox_client_from_db

    api, err = get_upstox_client_from_db()
    assert api and not err, f"no api client: {err}"
    rows = {r["symbol"]: r for r in json.load(open("experiments/chaser_asof.json"))["rows"]}

    for sym in TARGETS:
        df = api.fetch_historical_data_v3(
            symbol=sym, unit="days", interval=1, to_date=FREEZE, from_date=FROM)
        assert df is not None and not df.empty, sym
        idx_ist = df.index.tz_convert("Asia/Kolkata") if df.index.tz is not None \
            else df.index.tz_localize("UTC").tz_convert("Asia/Kolkata")
        df = df[idx_ist.date <= pd.Timestamp(FREEZE).date()]
        print(f"=== {sym}: {len(df)} bars, last bar IST={idx_ist[-1]}")
        print(df.tail(3)[["open", "high", "low", "close", "volume"]].to_string())

        highs = df["high"].astype(float).tolist()
        h52 = max(highs[-253:-1])  # prior 252 bars, current excluded
        close = float(df["close"].iloc[-1])
        dist = (h52 - close) / close * 100
        adx_v = float(wilder_adx(df["high"], df["low"], df["close"]).iloc[-1])
        rsi_v = float(wilder_rsi(df["close"]).iloc[-1])
        ma50 = float(df["close"].rolling(50).mean().iloc[-1])
        ma200 = float(df["close"].rolling(200).mean().iloc[-1])
        vavg = float(df["volume"].rolling(20).mean().iloc[-1])
        vol = float(df["volume"].iloc[-1])

        got = rows[sym]
        print(f"  indep: close={close:.2f} h52={h52:.2f} dist={dist:.3f}% "
              f"adx={adx_v:.2f} rsi={rsi_v:.2f} ma50={ma50:.2f} ma200={ma200:.2f} "
              f"vol={vol:.0f} vavg={vavg:.0f} ratio={vol / vavg:.3f}")
        print(f"  json : close={got['close']} h52={got['high52w']} dist={got['dist_pct']}% "
              f"adx={got['adx']} rsi={got['rsi']} ma50={got['ma50']} ma200={got['ma200']} "
              f"vol={got['vol']} vavg={got['vol_avg20']} ratio={got['vol_ratio']}")
        prox = dist <= 3.0
        gates = {"proximity_ok": prox, "adx_ok": adx_v >= 25,
                 "rsi_ok": 50 <= rsi_v <= 70, "vol_ok": vol >= 1.5 * vavg,
                 "ma50_ok": close >= ma50, "ma200_ok": close >= ma200}
        for g, v in gates.items():
            match = "MATCH" if bool(v) == bool(got[g]) else "*** MISMATCH ***"
            print(f"    {g}: indep={bool(v)} json={got[g]} {match}")
        sig = all(gates.values())
        print(f"  signal: indep={sig} json={got['signal']} "
              f"{'MATCH' if sig == got['signal'] else '*** MISMATCH ***'}")


if __name__ == "__main__":
    main()

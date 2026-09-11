"""VWAP + ORB replay engine.

Owns the full tick→sub-candle→VWAP→engine assembly that used to live inline in
``api/poc_nq.get_tick_replay`` so the generic replay endpoint and the legacy
adapter share one implementation.
"""
from __future__ import annotations

from trading.replay.contract import ParamSpec, ReplayContext, StrategyResult


class VwapOrbReplay:
    id = "vwap-orb"
    label = "VWAP + ORB"
    params = [
        ParamSpec("secs", "Candle seconds", "int", 2, min=1, max=60,
                  description="sub-candle resolution for the tick chart"),
        ParamSpec("orb", "Opening range (min)", "int", 15, min=1, max=120,
                  description="opening-range window in 1m bars"),
        ParamSpec("hist", "Overnight history (h)", "int", 8, min=0, max=24,
                  description="overnight history hours used for structure/TP only"),
    ]
    required_data = {"ticks", "bars", "hist_bars"}

    def run(self, ctx: ReplayContext) -> StrategyResult:
        from trading.vwap_orb import VWAPORBEngine, compute_or_window

        secs = int(ctx.params.get("secs", 2))
        orb = int(ctx.params.get("orb", 15))
        sub_s = max(1, min(secs, 60))
        orb = max(1, min(orb, 120))
        ticks = ctx.ticks
        bars = ctx.bars
        hist_bars = ctx.hist_bars or []

        eng = VWAPORBEngine(or_bars=orb)
        trades = eng.run(bars, ticks, hist=hist_bars if hist_bars else None)
        or_high, or_low, or_end = compute_or_window(bars, orb)

        # sub-candles (live forming-bar ticks) at the requested resolution + per-1m VWAP
        buckets: dict = {}
        for t in ticks:
            k = int(t["timestamp"] // 1000 // sub_s) * sub_s
            bid = t["bidPrice"]
            b = buckets.get(k)
            if b is None:
                buckets[k] = {"time": k, "open": bid, "high": bid, "low": bid, "close": bid}
            else:
                b["high"] = max(b["high"], bid)
                b["low"] = min(b["low"], bid)
                b["close"] = bid
        subs = [buckets[k] for k in sorted(buckets)]
        candles = [{"time": b["time"], "open": b["open"], "high": b["high"], "low": b["low"], "close": b["close"]} for b in bars]
        # progressive session VWAP: value at each 1m candle uses only ticks up to that candle
        vwap = []
        pv = vv = 0.0
        ti = 0
        ticks_sorted = sorted(ticks, key=lambda t: t["timestamp"])
        for c in candles:
            end_ms = (c["time"] + 60) * 1000
            while ti < len(ticks_sorted) and ticks_sorted[ti]["timestamp"] < end_ms:
                t = ticks_sorted[ti]
                v = (t.get("askVolume") or 0) + (t.get("bidVolume") or 0)
                if v > 0:
                    pv += ((t["askPrice"] + t["bidPrice"]) / 2.0) * v
                    vv += v
                ti += 1
            vwap.append({"time": c["time"], "value": round(pv / vv, 2) if vv else c["close"]})

        out = []
        for t in trades:
            out.append({
                "time": int(t["t_in"] // 60000) * 60,
                "exit_time": int(t["t_out"] // 60000) * 60,
                "side": t["side"], "kind": "vwap-orb", "entry": t["entry"], "sl": t["sl"],
                "tp": t["tp"], "exit": t["exit"], "result": t["result"], "pnl": t["pnl"], "rr": t["rr"],
            })

        return StrategyResult(
            trades=out,
            levels=[round(or_high, 2), round(or_low, 2)],
            extras={
                "candles": candles,
                "subs": subs,
                "vwap": vwap,
                "or_high": round(or_high, 2),
                "or_low": round(or_low, 2),
                "or_minutes": orb,
                "or_end": or_end,
                "hist_bars": len(hist_bars),
                "sub_secs": sub_s,
            },
        )

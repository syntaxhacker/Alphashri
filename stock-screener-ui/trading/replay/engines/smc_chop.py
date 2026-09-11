"""SMC chop-mode replay engine — thin wrapper over ``trading.smc_chop``.

Mirrors ``smc_ifvg.py``: the tick engine owns fills and trade dicts with
ms-epoch ``t_in``/``t_out``; this adapter floors times to the containing 1m bar
so the chart markers land on real candles.
"""
from __future__ import annotations

from trading.replay.contract import ParamSpec, ReplayContext, StrategyResult


class SmcChopReplay:
    id = "smc-chop"
    label = "SMC Chop"
    params = [
        ParamSpec("lookback", "Swing lookback", "int", 20, min=2, max=200),
        ParamSpec("sl_buf", "SL buffer (pts)", "float", 4.0),
        ParamSpec("min_rr", "Min R/R", "float", 2.0),
        ParamSpec("min_risk", "Min risk (pts)", "float", 8.0),
        ParamSpec("max_risk", "Max risk (pts)", "float", 30.0),
        ParamSpec("min_wick", "Min wick (pts)", "float", 1.5),
        ParamSpec("cooldown", "Cooldown bars", "int", 8, min=0, max=100),
    ]
    required_data = {"ticks", "bars"}

    def run(self, ctx: ReplayContext) -> StrategyResult:
        from trading.smc_chop import SMCChopEngine

        params = ctx.params or {}
        engine = SMCChopEngine(
            lookback=int(params.get("lookback", 20)),
            sl_buf=float(params.get("sl_buf", 4.0)),
            min_rr=float(params.get("min_rr", 2.0)),
            min_risk=float(params.get("min_risk", 8.0)),
            max_risk=float(params.get("max_risk", 30.0)),
            min_wick=float(params.get("min_wick", 1.5)),
            cooldown=int(params.get("cooldown", 8)),
        )
        trades = engine.run(ctx.bars, ctx.ticks)

        out = []
        for t in trades:
            out.append({
                "time": int(t["t_in"] // 60000) * 60,
                "exit_time": int(t["t_out"] // 60000) * 60,
                "side": t["side"], "kind": t["kind"], "entry": t["entry"], "sl": t["sl"],
                "tp": t["tp"], "exit": t["exit"], "result": t["result"], "pnl": t["pnl"],
                "rr": t["rr"],
            })
        return StrategyResult(trades=out, extras={"bars": ctx.bars})

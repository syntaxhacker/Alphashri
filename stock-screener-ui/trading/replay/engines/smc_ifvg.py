"""SMC inverse-FVG replay engine."""
from __future__ import annotations

from trading.replay.contract import ParamSpec, ReplayContext, StrategyResult


class SmcIfvgReplay:
    id = "smc-ifvg"
    label = "SMC iFVG"
    params = [
        ParamSpec("entries", "Entries", "select", "both", options=["both", "inv", "retest"],
                  description="divided stacks (inv/retest) or legacy coupled"),
        ParamSpec("flip", "Flip margin", "float", None,
                  description="inv_flip_margin: strong inversions flip bias (experimental)"),
        ParamSpec("from_ist", "From IST", "text", None,
                  description="filter trades entered at/after HH:MM IST"),
        ParamSpec("to_ist", "To IST", "text", None,
                  description="filter trades entered at/before HH:MM IST"),
    ]
    required_data = {"ticks", "bars"}

    def run(self, ctx: ReplayContext) -> StrategyResult:
        from datetime import datetime

        from config import IST
        from trading.smc_ifvg import SMCIFVGEngine

        entries = ctx.params.get("entries", "both")
        flip = ctx.params.get("flip")
        from_ist = ctx.params.get("from_ist")
        to_ist = ctx.params.get("to_ist")

        bars = ctx.bars
        ticks = ctx.ticks
        trades = SMCIFVGEngine(entries=entries, **({"inv_flip_margin": flip} if flip else {})).run(bars, ticks)

        out = []
        for t in trades:
            tin = datetime.fromtimestamp(t["t_in"] / 1000, tz=IST).strftime("%H:%M")
            if from_ist and tin < from_ist:
                continue
            if to_ist and tin > to_ist:
                continue
            # floor to containing 1m bar — lightweight-charts markers reject non-bar times
            out.append({
                "time": int(t["t_in"] // 60000) * 60, "exit_time": int(t["t_out"] // 60000) * 60,
                "side": t["side"], "kind": t["kind"], "entry": t["entry"], "sl": t["sl"],
                "tp": t["tp"], "exit": t["exit"], "result": t["result"], "pnl": t["pnl"], "rr": t["rr"],
            })

        return StrategyResult(trades=out, extras={"bars": bars})

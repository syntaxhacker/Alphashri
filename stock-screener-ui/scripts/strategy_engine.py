#!/usr/bin/env python3
"""Reusable strategy engine — one base class for spot/chain strategies.

The pattern used by every engine in `scripts/wall_replay/` is the same:

    load rows -> loop bars -> signal() -> fill at t+1 -> exit_rules() -> costs

Subclass `StrategyEngine` and override `signal()` / `exit_rules()`. The base
handles the tape, ATM/ITM strike selection, costs, one-position-at-a-time,
cooldowns, EOD, and the standard stats (n / win / net / PF / DD / avg).

Example:
    class EmaCross(StrategyEngine):
        def signal(self, i, ctx):
            if ctx.ema9 > ctx.ema21 and ctx.prev_ema9 <= ctx.prev_ema21:
                return "CE"
            if ctx.ema9 < ctx.ema21 and ctx.prev_ema9 >= ctx.prev_ema21:
                return "PE"
            return None

    eng = EmaCross(tape=HIST)
    trades = eng.run_all(dates, {"stop": 0.2, "hold": 30})
    print(eng.stats(trades))
"""

from __future__ import annotations

import statistics
import sys
from dataclasses import dataclass
from datetime import datetime, time
from pathlib import Path
from typing import Iterable, Optional

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from options_paper import costs  # noqa: E402

LOT = 65


@dataclass
class Context:
    """Everything a signal may need at bar i."""
    rows: list
    closes: list
    i: int
    spot: float
    prev: float
    tm: time
    atr: float
    vwap: float
    ema9: float
    ema21: float
    prev_ema9: float
    prev_ema21: float
    max_pain: float
    walls: dict
    chain: dict


class StrategyEngine:
    tape: Path = ROOT / "experiments" / "data" / "nifty_hist"

    def __init__(self, tape: Optional[Path] = None):
        self.tape = Path(tape) if tape else self.tape
        self._cache: dict[str, list] = {}

    # ---------- data ----------
    def dates(self) -> list[str]:
        return sorted(p.stem for p in self.tape.glob("*.jsonl")
                      if not p.stem.startswith("_") and ".gaps" not in p.stem)

    def rows(self, date: str) -> list:
        if date not in self._cache:
            import json
            p = self.tape / f"{date}.jsonl"
            self._cache[date] = [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
        return self._cache[date]

    # ---------- hooks ----------
    def signal(self, i: int, ctx: Context) -> Optional[str]:
        """Return 'CE' (long call) or 'PE' (long put) or None."""
        raise NotImplementedError

    def exit_rules(self, pos: dict, i: int, ctx: Context) -> Optional[str]:
        """Return an exit reason or None. Default: stop / target / EOD."""
        p = self.px(ctx, pos["strike"], pos["opt"])
        if p <= 0:
            return None
        if p <= pos["stop"]:
            return "STOP"
        if pos.get("target") and p >= pos["entry"] * (1 + pos["target"]):
            return "TARGET"
        if ctx.tm >= time(pos.get("eod_hour", 15), pos.get("eod_min", 0)):
            return "EOD"
        return None

    # ---------- helpers ----------
    @staticmethod
    def px(ctx: Context, strike: float, opt: str) -> float:
        leg = (ctx.chain or {}).get(str(int(strike)))
        return float(leg[0] if opt == "CE" else leg[1]) if leg and len(leg) >= 2 else 0.0

    @staticmethod
    def atm(spot: float) -> float:
        return round(spot / 50.0) * 50.0

    def strike_for(self, spot: float, opt: str, cfg: dict) -> float:
        a = self.atm(spot)
        off = cfg.get("strike_offset", 0)
        return a - off if opt == "CE" else a + off

    # ---------- run ----------
    def run(self, date: str, cfg: dict) -> list[dict]:
        rows = self.rows(date)
        if len(rows) < 60:
            return []
        closes = [float(r["spot"]) for r in rows]
        trades, pos = [], None
        last_exit = -999
        for i in range(1, len(rows) - 1):
            r = rows[i]
            spot = float(r["spot"])
            tm = datetime.fromisoformat(r["t"]).time()
            ctx = self._ctx(rows, closes, i, spot, tm)
            if pos:
                reason = self.exit_rules(pos, i, ctx)
                if reason:
                    p = self.px(ctx, pos["strike"], pos["opt"]) or pos["entry"]
                    c = costs.option_round_trip_cost(pos["entry"], p, LOT)
                    trades.append({**pos, "exit": p, "net": c["net_pnl"],
                                   "gross": c["gross_pnl"], "costs": c["costs"],
                                   "reason": reason, "exit_time": r["t"]})
                    pos = None
                    last_exit = i
                continue
            if tm < time(cfg.get("open_hour", 9), cfg.get("open_min", 30)):
                continue
            if i - last_exit < cfg.get("cooldown", 15):
                continue
            sig = self.signal(i, ctx)
            if not sig:
                continue
            strike = self.strike_for(spot, sig, cfg)
            fill = self.px(ctx, strike, sig) if False else None
            fill = self.px(self._ctx(rows, closes, i + 1, float(rows[i + 1]["spot"]),
                                     datetime.fromisoformat(rows[i + 1]["t"]).time()),
                           strike, sig)
            if fill <= 0:
                continue
            pos = {"dir": "LONG", "opt": sig, "strike": strike, "entry": fill,
                   "best": fill, "stop": fill * (1 - cfg.get("stop", 0.2)),
                   "target": cfg.get("target", 0), "entry_i": i + 1,
                   "entry_time": rows[i + 1]["t"], "why": cfg.get("name", "signal")}
        return trades

    def _ctx(self, rows, closes, i, spot, tm) -> Context:
        r = rows[i]
        a = self._atr(closes, i)
        vwap = sum(closes[max(0, i - 29): i + 1]) / len(closes[max(0, i - 29): i + 1])
        e9 = self._ema(closes[: i + 1], 9)
        e21 = self._ema(closes[: i + 1], 21)
        e9p = self._ema(closes[:i], 9)
        e21p = self._ema(closes[:i], 21)
        return Context(rows=rows, closes=closes, i=i, spot=spot, prev=closes[i - 1],
                       tm=tm, atr=a, vwap=vwap, ema9=e9, ema21=e21,
                       prev_ema9=e9p, prev_ema21=e21p,
                       max_pain=float(r.get("max_pain") or 0),
                       walls=r.get("walls") or {}, chain=r.get("chain") or {})

    @staticmethod
    def _ema(vals, n):
        if not vals:
            return 0.0
        k = 2.0 / (n + 1)
        out = vals[0]
        for v in vals[1:]:
            out = v * k + out * (1 - k)
        return out

    @staticmethod
    def _atr(closes, i, n=14):
        cl = closes[max(0, i - n): i + 1]
        return sum(abs(cl[j] - cl[j - 1]) for j in range(1, len(cl))) / max(1, len(cl) - 1)

    # ---------- batch + stats ----------
    def run_all(self, dates: Iterable[str], cfg: dict) -> list[dict]:
        out = []
        for d in dates:
            out += self.run(d, cfg)
        return out

    @staticmethod
    def split(dates: list[str], boundary="2025-11-01"):
        return ([d for d in dates if d < boundary],
                [d for d in dates if d >= boundary])

    @staticmethod
    def stats(trades: list[dict]) -> dict:
        n = len(trades)
        wins = [t["net"] for t in trades if t["net"] > 0]
        loss = [t["net"] for t in trades if t["net"] < 0]
        net = sum(t["net"] for t in trades)
        gw, gl = sum(wins), -sum(loss)
        eq = peak = dd = 0.0
        for t in sorted(trades, key=lambda x: x["exit_time"]):
            eq += t["net"]
            peak = max(peak, eq)
            dd = min(dd, eq - peak)
        return {"n": n, "win": len(wins), "net": net,
                "pf": (gw / gl if gl else 0.0), "dd": dd,
                "avg": (net / n if n else 0.0),
                "avg_win": (statistics.mean(wins) if wins else 0.0),
                "avg_loss": (statistics.mean(loss) if loss else 0.0)}

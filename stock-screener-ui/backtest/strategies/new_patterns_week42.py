"""New trend/breakout pattern variants — Week 42 (2026-10-05..2026-10-09) research.

Pure-pandas daily-bar backtests implementing :class:`BaseStrategy` so
``BacktestEngine.run(strategy_id, ...)`` can execute them. Nautilus is NOT
required (it is not installed in this env); execution semantics are
identical across all variants so results are comparable:

* signal on close(T) -> enter next session open (gap-and-go enters same-day
  open since the gap is known pre-entry; documented on the variant).
* LONG only, one position per symbol at a time, no re-entry while holding.
* SL = max(1xATR(14)_T, entry - signal_level) when a signal level exists,
  else 1xATR(14)_T. Target = entry + 2R.
* exits: TARGET / SL / WEEK_END (Friday 2026-10-09 close). Same-bar
  ambiguity resolves SL-first (conservative).
* sizing: floor(100000 / entry), min 1 share. Costs via
  ``backtest.costs.calculate_trading_costs`` on EVERY trade.

Reuse (not reinvented):
* accumulation math (OBV slope, vol_ratio 5/20) -> ``chart_patterns.watch._near52w_row``
* EMA/RSI/ADX/ATR -> ``trading.indicators`` (canonical)
* ADX latest-value semantics -> ``trading.adx_trend_signals.compute_adx``
* EMA-cross reference levels -> ``trading.ema_cross_signals`` (see ema_stack notes)
"""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import Dict, List, Optional

import pandas as pd

from .base import BaseStrategy, StrategyParam
from ..costs import calculate_trading_costs

SIG_START = date(2026, 10, 5)
SIG_END = date(2026, 10, 9)
WEEK_END = date(2026, 10, 9)
NOTIONAL = 100_000.0

_LIVE_FETCHES = 0


def _ist_session_dates(df: pd.DataFrame) -> pd.Series:
    idx = df.index
    try:
        if idx.tz is None:
            ist = idx.tz_localize("UTC").tz_convert("Asia/Kolkata")
        else:
            ist = idx.tz_convert("Asia/Kolkata")
    except Exception:
        ist = idx
    return pd.Series([d.date() for d in ist], index=df.index)


def fetch_daily(symbol: str) -> Optional[pd.DataFrame]:
    """Daily frame from disk cache first (no Upstox budget spent on hits)."""
    global _LIVE_FETCHES
    from chart_patterns import candles as _candles

    prov: dict = {}
    try:
        df = _candles.fetch_for_timeframe(symbol, "1D", provenance=prov)
    except Exception:
        return None
    if df is None or getattr(df, "empty", True):
        return None
    if not prov.get("from_cache"):
        _LIVE_FETCHES += 1
    need = {"open", "high", "low", "close", "volume"}
    if not need.issubset(set(df.columns)):
        return None
    out = df.copy()
    out["_sess"] = _ist_session_dates(out)
    return out.sort_index()


def _add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    from trading.indicators import ema, rsi, adx, atr

    close = df["close"].astype(float)
    high = df["high"].astype(float)
    low = df["low"].astype(float)
    out = df.copy()
    out["_ema20"] = ema(close, 20)
    out["_ema50"] = ema(close, 50)
    out["_rsi14"] = rsi(close, 14)
    out["_adx14"] = adx(high, low, close, 14)
    out["_atr14"] = atr(high, low, close, 14)
    out["_vol20"] = df["volume"].astype(float).rolling(20).mean()
    out["_hi20"] = high.shift(1).rolling(20).max()  # prior 20d high excl. today
    return out


def _adx_latest(high, low, close) -> dict:
    """Live-semantics ADX via trading.adx_trend_signals.compute_adx (reused)."""
    from trading.adx_trend_signals import compute_adx

    return compute_adx(
        [float(v) for v in high], [float(v) for v in low], [float(v) for v in close], 14
    )


class _DailyBreakoutBase(BaseStrategy):
    """Shared fetch + simulate + aggregate for all week-42 variants."""

    strategy_id = "week42_base"
    lookback_min = 60

    # -- variant hook -----------------------------------------------------
    def signal_mask(self, df: pd.DataFrame) -> pd.Series:
        """Boolean Series (aligned to df) — True where close(T) is a signal."""
        raise NotImplementedError

    def signal_level(self, df: pd.DataFrame, i: int) -> Optional[float]:
        """Optional protective level below entry (e.g. prior close, trough)."""
        return None

    def signal_detail(self, df: pd.DataFrame, i: int) -> dict:
        return {}

    # -- BaseStrategy -----------------------------------------------------
    @classmethod
    def get_name(cls) -> str:
        return cls.strategy_id

    @classmethod
    def get_description(cls) -> str:
        return f"Week42 research variant {cls.strategy_id}"

    @classmethod
    def get_params(cls) -> List[StrategyParam]:
        return []

    def validate_params(self, params: Dict) -> List[str]:
        return []

    # -- run --------------------------------------------------------------
    def run(self, symbols: List[str], days: int, params: Dict,
            progress_callback=None) -> Dict:
        global _LIVE_FETCHES
        _LIVE_FETCHES = 0
        workers = max(1, min(6, (os.cpu_count() or 4) - 2))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            frames = list(pool.map(fetch_daily, [s.upper() for s in symbols]))

        results, chart_data, candles, skipped = [], {}, {}, []
        n_signals = n_unfilled = 0
        done = 0
        for sym, df in zip([s.upper() for s in symbols], frames):
            done += 1
            if progress_callback and done % 50 == 0:
                progress_callback(done, len(symbols), f"{done}/{len(symbols)}")
            if df is None or len(df) < self.lookback_min:
                skipped.append({"symbol": sym, "error": "no data / short history"})
                continue
            try:
                res = self._run_symbol(sym, df)
            except Exception as exc:  # never let one symbol kill the run
                skipped.append({"symbol": sym, "error": str(exc)[:200]})
                continue
            n_signals += res["n_signals"]
            n_unfilled += res["n_unfilled"]
            candles[sym] = res["candles"]
            if res["trades"]:
                chart_data[sym] = {"trades": res["trades"], "visuals": []}
            if res["result"]:
                results.append(res["result"])
                # stash full trade list on the result for the JSON dump
                res["result"]["_trade_list"] = res["trades"]

        total_gross = sum(r["gross_pnl"] for r in results)
        total_costs = sum(r["total_costs"] for r in results)
        total_net = sum(r["net_pnl"] for r in results)
        total_trades = sum(r["trades"] for r in results)
        total_wins = sum(r["wins"] for r in results)
        win_rate = (total_wins / total_trades * 100) if total_trades else 0.0
        gp = sum(r["gross_profit"] for r in results)
        gl = sum(r["gross_loss"] for r in results)
        if gl > 0:
            pf = gp / gl
        else:
            pf = float("inf") if gp > 0 else 0.0
        expectancy = (total_net / total_trades) if total_trades else 0.0
        # maxDD over exit-ordered cumulative net equity (₹)
        eq, peak, maxdd = 0.0, 0.0, 0.0
        for r in sorted(results, key=lambda x: x.get("_last_exit", "")):
            for t in r["_trade_list"]:
                eq += t["net_pnl"]
                peak = max(peak, eq)
                maxdd = max(maxdd, peak - eq)
        for r in results:
            r.pop("_trade_list", None)
            r.pop("_last_exit", None)
        from datetime import datetime as _dt

        return {
            "strategy": self.strategy_id,
            "results": results,
            "totals": {
                "gross_pnl": round(total_gross, 2),
                "total_costs": round(total_costs, 2),
                "net_pnl": round(total_net, 2),
                "trades": total_trades,
                "win_rate": round(win_rate, 1),
                "pf": round(pf, 2) if pf != float("inf") else "inf",
                "expectancy": round(expectancy, 2),
                "maxdd": round(maxdd, 2),
                "n_signals": n_signals,
                "n_unfilled_friday": n_unfilled,
                "stocks_tested": len(results) + len(skipped),
                "live_fetches": _LIVE_FETCHES,
            },
            "chart_data": chart_data,
            "candles": candles,
            "skipped_stocks": skipped,
            "config": {"symbols": symbols, "days": days, "params": params,
                       "window": [SIG_START.isoformat(), SIG_END.isoformat()]},
            "run_time": _dt.now().isoformat(),
        }

    # -- per-symbol --------------------------------------------------------
    def _run_symbol(self, sym: str, df: pd.DataFrame) -> dict:
        df = _add_indicators(df)
        mask = self.signal_mask(df)
        sess = df["_sess"]
        in_window = sess.map(lambda d: SIG_START <= d <= SIG_END)
        sig_idx = [i for i, m in enumerate(mask) if bool(m) and bool(in_window.iloc[i])]

        trades = []
        holding: Optional[dict] = None

        def close_position(exit_price: float, exit_date, reason: str):
            entry = holding["entry"]
            qty = holding["qty"]
            gross = (exit_price - entry) * qty
            costs = calculate_trading_costs(entry, exit_price, qty)["total_costs"]
            trades.append({
                "symbol": sym,
                "signal_date": holding["signal_date"],
                "entry_date": holding["entry_date"],
                "exit_date": str(exit_date),
                "entry_price": round(entry, 2),
                "exit_price": round(exit_price, 2),
                "quantity": qty,
                "risk_R": round(holding["R"], 2),
                "stop": round(holding["sl"], 2),
                "target": round(holding["tgt"], 2),
                "gross_pnl": round(gross, 2),
                "trading_costs": round(costs, 2),
                "net_pnl": round(gross - costs, 2),
                "exit_reason": reason,
                "hold_days": holding["hold"],
                "detail": holding["detail"],
            })

        # sessions present in frame for entry lookup
        n = len(df)
        sig_set = dict.fromkeys(sig_idx)  # preserve order
        entered_for: set = set()

        # walk bars in order; entries trigger on bar AFTER signal
        pending: list = []  # signal bar positions awaiting next open
        for i in range(n):
            sdate = sess.iloc[i]
            # manage open holding against today's bar
            if holding is not None:
                holding["hold"] += 1
                low, high, close = (float(df["low"].iloc[i]),
                                    float(df["high"].iloc[i]),
                                    float(df["close"].iloc[i]))
                sl, tgt = holding["sl"], holding["tgt"]
                if low <= sl:
                    close_position(sl, sdate, "SL")
                    holding = None
                elif high >= tgt:
                    close_position(tgt, sdate, "TARGET")
                    holding = None
                elif sdate >= WEEK_END:
                    close_position(close, sdate, "WEEK_END")
                    holding = None
                # else keep holding
            # enter pending signal at today's open (single position only)
            if holding is None and pending and sdate <= WEEK_END:
                j = pending.pop(0)
                if j in entered_for:
                    continue
                # entry only if signal date strictly before entry session
                if sess.iloc[j] < sdate:
                    entry = float(df["open"].iloc[i])
                    atr = float(df["_atr14"].iloc[j])
                    if not (atr > 0):
                        continue
                    lvl = self.signal_level(df, j)
                    R = atr
                    if lvl is not None and entry - lvl > 0:
                        R = max(atr, entry - lvl)
                    qty = max(1, int(NOTIONAL // entry)) if entry > 0 else 0
                    if qty <= 0:
                        continue
                    holding = {
                        "entry": entry, "qty": qty, "R": R,
                        "sl": entry - R, "tgt": entry + 2 * R,
                        "signal_date": str(sess.iloc[j]),
                        "entry_date": str(sdate), "hold": 0,
                        "detail": self.signal_detail(df, j),
                    }
                    entered_for.add(j)
                    # same-bar resolution: entry bar can stop/target out
                    low0, high0 = float(df["low"].iloc[i]), float(df["high"].iloc[i])
                    holding["hold"] += 1
                    if low0 <= holding["sl"]:
                        close_position(holding["sl"], sdate, "SL")
                        holding = None
                    elif high0 >= holding["tgt"]:
                        close_position(holding["tgt"], sdate, "TARGET")
                        holding = None
                    elif sdate >= WEEK_END:
                        close_position(float(df["close"].iloc[i]), sdate, "WEEK_END")
                        holding = None
            # arm new signals (close-based; arms for NEXT session)
            if i in sig_set and holding is None:
                # gap-and-go overrides arming (same-day open entry); see subclass
                if not getattr(self, "same_day_entry", False):
                    pending.append(i)
            if sdate > WEEK_END and holding is None and not pending:
                pass

        n_unfilled = len([j for j in sig_idx
                          if j not in entered_for and sess.iloc[j] >= WEEK_END])
        # any Friday-pending signals never entered
        wins = sum(1 for t in trades if t["net_pnl"] > 0)
        losses = sum(1 for t in trades if t["net_pnl"] < 0)
        gp = sum(t["net_pnl"] for t in trades if t["net_pnl"] > 0)
        gl = abs(sum(t["net_pnl"] for t in trades if t["net_pnl"] < 0))
        pf = (gp / gl) if gl > 0 else (float("inf") if gp > 0 else 0.0)
        result = None
        if trades:
            result = {
                "symbol": sym,
                "trades": len(trades),
                "wins": wins, "losses": losses,
                "win_rate": round(wins / len(trades) * 100, 1),
                "gross_pnl": round(sum(t["gross_pnl"] for t in trades), 2),
                "total_costs": round(sum(t["trading_costs"] for t in trades), 2),
                "net_pnl": round(sum(t["net_pnl"] for t in trades), 2),
                "pf": round(pf, 2) if pf != float("inf") else "inf",
                "gross_profit": round(gp, 2), "gross_loss": round(gl, 2),
                "_last_exit": max(t["exit_date"] for t in trades),
            }
        candles = {
            "index": [str(x)[:19] for x in df.index[-30:]],
            "close": [round(float(v), 2) for v in df["close"].tail(30)],
        }
        return {"result": result, "trades": trades, "candles": candles,
                "n_signals": len(sig_idx), "n_unfilled": n_unfilled}


# ======================================================================
# Variants
# ======================================================================

class AccumBreakoutStrategy(_DailyBreakoutBase):
    strategy_id = "accum_breakout"
    lookback_min = 60

    @classmethod
    def get_name(cls) -> str:
        return "Accumulation Breakout (OBV slope + vol + 20d-high)"

    @classmethod
    def get_description(cls) -> str:
        return ("20d-high close break with 20d OBV slope>0 and 5/20 vol ratio>=1.5 "
                "(accumulation math reused from chart_patterns.watch._near52w_row).")

    def signal_mask(self, df: pd.DataFrame) -> pd.Series:
        from chart_patterns.watch import _near52w_row

        out = pd.Series(False, index=df.index)
        closes = df["close"].astype(float)
        highs = df["high"].astype(float)
        for k in range(len(df)):
            sdate = df["_sess"].iloc[k]
            if not (SIG_START <= sdate <= SIG_END):
                continue
            if k < 25:
                continue
            if not (float(closes.iloc[k]) > float(highs.iloc[k - 20:k].max())):
                continue
            row = _near52w_row("X", df.iloc[:k + 1])
            if row is None:
                continue
            if row["obv_slope"] > 0 and row["vol_ratio"] >= 1.5:
                out.iloc[k] = True
        return out

    def signal_detail(self, df: pd.DataFrame, i: int) -> dict:
        from chart_patterns.watch import _near52w_row

        row = _near52w_row("X", df.iloc[:i + 1]) or {}
        return {"obv_slope": round(float(row.get("obv_slope", 0)), 4),
                "vol_ratio": round(float(row.get("vol_ratio", 0)), 3)}


class AccumAdxGatedStrategy(AccumBreakoutStrategy):
    strategy_id = "accum_adx_gated"

    @classmethod
    def get_name(cls) -> str:
        return "Accumulation Breakout + ADX>=20 gate"

    @classmethod
    def get_description(cls) -> str:
        return "Accumulation breakout (as accum_breakout) only when ADX(14)>=20."

    def signal_mask(self, df: pd.DataFrame) -> pd.Series:
        base = super().signal_mask(df)
        adx = df["_adx14"]
        gate = adx.fillna(0) >= 20
        return base & gate.fillna(False)


class GapAndGoStrategy(_DailyBreakoutBase):
    """Gap >=3% over prior 20d high; enter SAME-DAY open; SL = prior close.

    The gap is known before the open so entry is causal. The 1.5x volume
    confirmation is only known at the close: if the entry day's volume
    fails it, exit next open as VOL_FAIL (also causal).
    """
    strategy_id = "gap_and_go"
    lookback_min = 60
    same_day_entry = True  # handled via custom arming below

    @classmethod
    def get_name(cls) -> str:
        return "Gap-and-Go (>=3% over 20d high, enter open)"

    @classmethod
    def get_description(cls) -> str:
        return "Enter same-day open on >=3% gap over prior 20d high; SL=prior close."

    def signal_mask(self, df: pd.DataFrame) -> pd.Series:
        out = pd.Series(False, index=df.index)
        opens = df["open"].astype(float)
        highs = df["high"].astype(float)
        for k in range(21, len(df)):
            sdate = df["_sess"].iloc[k]
            if not (SIG_START <= sdate <= SIG_END):
                continue
            prior20 = float(highs.iloc[k - 20:k].max())
            if prior20 <= 0:
                continue
            gap = (float(opens.iloc[k]) - prior20) / prior20
            if gap >= 0.03:
                out.iloc[k] = True
        return out

    def signal_level(self, df: pd.DataFrame, i: int) -> Optional[float]:
        return float(df["close"].iloc[i - 1]) if i > 0 else None

    def signal_detail(self, df: pd.DataFrame, i: int) -> dict:
        highs = df["high"].astype(float)
        prior20 = float(highs.iloc[i - 20:i].max())
        gap = (float(df["open"].iloc[i]) - prior20) / prior20 * 100
        return {"gap_pct": round(gap, 2), "prior20_high": round(prior20, 2)}

    # gap-and-go enters at the signal bar's own open: override per-symbol run
    def _run_symbol(self, sym: str, df: pd.DataFrame) -> dict:
        df = _add_indicators(df)
        mask = self.signal_mask(df)
        sess = df["_sess"]
        sig_idx = [i for i in range(len(df))
                   if bool(mask.iloc[i]) and SIG_START <= sess.iloc[i] <= SIG_END]
        trades = []
        busy_until = -1
        for j in sig_idx:
            if j <= busy_until:
                continue
            entry = float(df["open"].iloc[j])
            sdate = sess.iloc[j]
            if sdate > WEEK_END:
                continue
            atr = float(df["_atr14"].iloc[j])
            if not (atr > 0):
                continue
            prior_close = float(df["close"].iloc[j - 1])
            R = max(atr, entry - prior_close) if entry - prior_close > 0 else atr
            qty = max(1, int(NOTIONAL // entry)) if entry > 0 else 0
            if qty <= 0:
                continue
            sl, tgt = entry - R, entry + 2 * R
            detail = self.signal_detail(df, j)
            # walk forward from entry bar
            exited = False
            for i in range(j, len(df)):
                d = sess.iloc[i]
                if d > WEEK_END:
                    break
                low, high, close = (float(df["low"].iloc[i]),
                                    float(df["high"].iloc[i]),
                                    float(df["close"].iloc[i]))
                if low <= sl:
                    self._book(trades, sym, str(sdate), str(d), entry, sl,
                               qty, R, sl, tgt, detail, "SL", i - j + 1)
                    exited = True
                    busy_until = i
                    break
                if high >= tgt:
                    self._book(trades, sym, str(sdate), str(d), entry, tgt,
                               qty, R, sl, tgt, detail, "TARGET", i - j + 1)
                    exited = True
                    busy_until = i
                    break
                if i == j:
                    # EOD volume confirmation: fail -> mark, exit next open
                    vmean = float(df["_vol20"].iloc[j])
                    vol = float(df["volume"].iloc[j])
                    if vmean > 0 and vol < 1.5 * vmean:
                        if j + 1 < len(df) and sess.iloc[j + 1] <= WEEK_END:
                            px = float(df["open"].iloc[j + 1])
                            self._book(trades, sym, str(sdate),
                                       str(sess.iloc[j + 1]), entry, px,
                                       qty, R, sl, tgt, detail, "VOL_FAIL", 2)
                        else:
                            self._book(trades, sym, str(sdate), str(d),
                                       entry, close, qty, R, sl, tgt,
                                       detail, "WEEK_END", 1)
                        exited = True
                        busy_until = j
                        break
                if d >= WEEK_END:
                    self._book(trades, sym, str(sdate), str(d), entry, close,
                               qty, R, sl, tgt, detail, "WEEK_END", i - j + 1)
                    exited = True
                    busy_until = i
                    break
            if not exited:
                busy_until = len(df) - 1
        wins = sum(1 for t in trades if t["net_pnl"] > 0)
        gp = sum(t["net_pnl"] for t in trades if t["net_pnl"] > 0)
        gl = abs(sum(t["net_pnl"] for t in trades if t["net_pnl"] < 0))
        pf = (gp / gl) if gl > 0 else (float("inf") if gp > 0 else 0.0)
        result = None
        if trades:
            result = {
                "symbol": sym, "trades": len(trades), "wins": wins,
                "losses": sum(1 for t in trades if t["net_pnl"] < 0),
                "win_rate": round(wins / len(trades) * 100, 1),
                "gross_pnl": round(sum(t["gross_pnl"] for t in trades), 2),
                "total_costs": round(sum(t["trading_costs"] for t in trades), 2),
                "net_pnl": round(sum(t["net_pnl"] for t in trades), 2),
                "pf": round(pf, 2) if pf != float("inf") else "inf",
                "gross_profit": round(gp, 2), "gross_loss": round(gl, 2),
                "_last_exit": max(t["exit_date"] for t in trades),
            }
        candles = {"index": [str(x)[:19] for x in df.index[-30:]],
                   "close": [round(float(v), 2) for v in df["close"].tail(30)]}
        return {"result": result, "trades": trades, "candles": candles,
                "n_signals": len(sig_idx), "n_unfilled": 0}

    @staticmethod
    def _book(trades, sym, sdate, edate, entry, exitp, qty, R, sl, tgt,
              detail, reason, hold):
        gross = (exitp - entry) * qty
        costs = calculate_trading_costs(entry, exitp, qty)["total_costs"]
        trades.append({"symbol": sym, "signal_date": sdate, "entry_date": sdate,
                       "exit_date": edate, "entry_price": round(entry, 2),
                       "exit_price": round(exitp, 2), "quantity": qty,
                       "risk_R": round(R, 2), "stop": round(sl, 2),
                       "target": round(tgt, 2), "gross_pnl": round(gross, 2),
                       "trading_costs": round(costs, 2),
                       "net_pnl": round(gross - costs, 2),
                       "exit_reason": reason, "hold_days": hold,
                       "detail": detail})


class High52WVolStrategy(_DailyBreakoutBase):
    strategy_id = "high52w_vol"
    lookback_min = 260

    @classmethod
    def get_name(cls) -> str:
        return "52W-high + Volume (within 1%, 2x vol)"

    @classmethod
    def get_description(cls) -> str:
        return "Close within 1% under prior 252d high with volume>=2x 20d avg."

    def signal_mask(self, df: pd.DataFrame) -> pd.Series:
        out = pd.Series(False, index=df.index)
        highs = df["high"].astype(float)
        closes = df["close"].astype(float)
        vols = df["volume"].astype(float)
        for k in range(252, len(df)):
            sdate = df["_sess"].iloc[k]
            if not (SIG_START <= sdate <= SIG_END):
                continue
            prior = float(highs.iloc[k - 252:k].max())
            if prior <= 0:
                continue
            c = float(closes.iloc[k])
            gap = (prior - c) / prior
            if not (0 < gap <= 0.01):
                continue
            vmean = float(vols.iloc[k - 20:k].mean())
            if vmean > 0 and float(vols.iloc[k]) >= 2 * vmean:
                out.iloc[k] = True
        return out

    def signal_detail(self, df: pd.DataFrame, i: int) -> dict:
        prior = float(df["high"].astype(float).iloc[i - 252:i].max())
        return {"prior252": round(prior, 2),
                "gap_pct": round((prior - float(df['close'].iloc[i])) / prior * 100, 3),
                "volx": round(float(df["volume"].iloc[i]) / float(df["_vol20"].iloc[i]), 2)
                if float(df["_vol20"].iloc[i]) > 0 else None}


class FailedBreakdownStrategy(_DailyBreakoutBase):
    strategy_id = "failed_breakdown"
    lookback_min = 60

    @classmethod
    def get_name(cls) -> str:
        return "Failed-breakdown Reversal (reclaim on 1.5x vol)"

    @classmethod
    def get_description(cls) -> str:
        return ("Broke 20d low within last 5 sessions, reclaimed on >=1.5x "
                "volume. SL level = breakdown trough.")

    def signal_mask(self, df: pd.DataFrame) -> pd.Series:
        out = pd.Series(False, index=df.index)
        lows = df["low"].astype(float)
        closes = df["close"].astype(float)
        vols = df["volume"].astype(float)
        for k in range(30, len(df)):
            sdate = df["_sess"].iloc[k]
            if not (SIG_START <= sdate <= SIG_END):
                continue
            base = float(lows.iloc[k - 26:k - 5].min())  # 20d low before last 5
            if base <= 0:
                continue
            trough = float(lows.iloc[k - 5:k].min())
            if not (trough < base):
                continue
            if not (float(closes.iloc[k]) > base):
                continue
            vmean = float(vols.iloc[k - 20:k].mean())
            if vmean > 0 and float(vols.iloc[k]) >= 1.5 * vmean:
                out.iloc[k] = True
        return out

    def signal_level(self, df: pd.DataFrame, i: int) -> Optional[float]:
        return float(df["low"].astype(float).iloc[i - 5:i + 1].min())

    def signal_detail(self, df: pd.DataFrame, i: int) -> dict:
        lows = df["low"].astype(float)
        return {"broken_level": round(float(lows.iloc[i - 26:i - 5].min()), 2),
                "trough": round(float(lows.iloc[i - 5:i + 1].min()), 2)}


class EmaStackBreakoutStrategy(_DailyBreakoutBase):
    """close > EMA20 > EMA50 + 20d-high break + vol>=1.5x.

    EMA levels reuse trading.indicators.ema (same helper the live
    EMACrossSignalGenerator wraps via trading.ema_cross_signals).
    """
    strategy_id = "ema_stack"
    use_gate = True
    lookback_min = 80

    @classmethod
    def get_name(cls) -> str:
        return "EMA-stack Momentum Breakout (close>20EMA>50EMA)"

    @classmethod
    def get_description(cls) -> str:
        return "20d-high break + vol>=1.5x, gated on close>EMA20>EMA50."

    def signal_mask(self, df: pd.DataFrame) -> pd.Series:
        out = pd.Series(False, index=df.index)
        closes = df["close"].astype(float)
        highs = df["high"].astype(float)
        vols = df["volume"].astype(float)
        e20, e50 = df["_ema20"], df["_ema50"]
        for k in range(55, len(df)):
            sdate = df["_sess"].iloc[k]
            if not (SIG_START <= sdate <= SIG_END):
                continue
            if not (float(closes.iloc[k]) > float(highs.iloc[k - 20:k].max())):
                continue
            vmean = float(vols.iloc[k - 20:k].mean())
            if not (vmean > 0 and float(vols.iloc[k]) >= 1.5 * vmean):
                continue
            if self.use_gate:
                a, b, c = (float(closes.iloc[k]), float(e20.iloc[k]),
                           float(e50.iloc[k]))
                if not (a > b > c):
                    continue
            out.iloc[k] = True
        return out


class EmaStackNoGateStrategy(EmaStackBreakoutStrategy):
    strategy_id = "ema_stack_nogate"
    use_gate = False

    @classmethod
    def get_name(cls) -> str:
        return "EMA-stack ABLATION (break+vol, no EMA gate)"


class AdxBreakoutStrategy(_DailyBreakoutBase):
    """ADX(14)>=25 and rising + DI+>DI- + 20d-high break.

    Latest-bar ADX semantics reuse trading.adx_trend_signals.compute_adx
    (same wrapper ADXTrendSignalGenerator.check_entry uses); the rising
    check uses the canonical trading.indicators.adx series.
    """
    strategy_id = "adx_breakout"
    use_gate = True
    lookback_min = 80

    @classmethod
    def get_name(cls) -> str:
        return "ADX Trend Breakout (ADX>=25 rising + 20d-high)"

    @classmethod
    def get_description(cls) -> str:
        return "20d-high break gated on ADX>=25, rising, DI+>DI-."

    def signal_mask(self, df: pd.DataFrame) -> pd.Series:
        out = pd.Series(False, index=df.index)
        closes = df["close"].astype(float)
        highs = df["high"].astype(float)
        lows = df["low"].astype(float)
        adxs = df["_adx14"]
        for k in range(40, len(df)):
            sdate = df["_sess"].iloc[k]
            if not (SIG_START <= sdate <= SIG_END):
                continue
            if not (float(closes.iloc[k]) > float(highs.iloc[k - 20:k].max())):
                continue
            if self.use_gate:
                a0, a1 = float(adxs.iloc[k]), float(adxs.iloc[k - 1])
                if not (a0 >= 25 and a0 > a1):
                    continue
                d = _adx_latest(highs.iloc[:k + 1], lows.iloc[:k + 1],
                                closes.iloc[:k + 1])
                if not (d["adx"] >= 25 and d["di_plus"] > d["di_minus"]):
                    continue
                self._last_adx = d
            out.iloc[k] = True
        return out

    def signal_detail(self, df: pd.DataFrame, i: int) -> dict:
        d = getattr(self, "_last_adx", None) or {}
        return {"adx": d.get("adx"), "di_plus": d.get("di_plus"),
                "di_minus": d.get("di_minus")}


class AdxBreakoutNoGateStrategy(AdxBreakoutStrategy):
    strategy_id = "adx_breakout_nogate"
    use_gate = False

    @classmethod
    def get_name(cls) -> str:
        return "ADX ABLATION (20d break only, no ADX gate)"


class RsiThrustStrategy(_DailyBreakoutBase):
    """RSI(14) crosses above 60 + 20d-high break (trading.indicators.rsi)."""
    strategy_id = "rsi_thrust"
    lookback_min = 80

    @classmethod
    def get_name(cls) -> str:
        return "RSI Momentum Thrust (cross 60 + 20d break)"

    @classmethod
    def get_description(cls) -> str:
        return "RSI(14) crosses above 60 with a 20d-high close break."

    def signal_mask(self, df: pd.DataFrame) -> pd.Series:
        out = pd.Series(False, index=df.index)
        closes = df["close"].astype(float)
        highs = df["high"].astype(float)
        rsi = df["_rsi14"]
        for k in range(40, len(df)):
            sdate = df["_sess"].iloc[k]
            if not (SIG_START <= sdate <= SIG_END):
                continue
            if not (float(closes.iloc[k]) > float(highs.iloc[k - 20:k].max())):
                continue
            r0, r1 = float(rsi.iloc[k]), float(rsi.iloc[k - 1])
            if r1 <= 60 < r0:
                out.iloc[k] = True
        return out

    def signal_detail(self, df: pd.DataFrame, i: int) -> dict:
        return {"rsi": round(float(df["_rsi14"].iloc[i]), 1),
                "rsi_prev": round(float(df["_rsi14"].iloc[i - 1]), 1)}


# -- baselines (same execution protocol, minimal entry logic) ---------------
class Base20dBreakoutStrategy(_DailyBreakoutBase):
    strategy_id = "base_20d"
    lookback_min = 60

    @classmethod
    def get_name(cls) -> str:
        return "BASELINE: plain 20d-high break"

    @classmethod
    def get_description(cls) -> str:
        return "Baseline: close breaks prior 20d high, no filters."

    def signal_mask(self, df: pd.DataFrame) -> pd.Series:
        out = pd.Series(False, index=df.index)
        closes = df["close"].astype(float)
        highs = df["high"].astype(float)
        for k in range(25, len(df)):
            sdate = df["_sess"].iloc[k]
            if not (SIG_START <= sdate <= SIG_END):
                continue
            if float(closes.iloc[k]) > float(highs.iloc[k - 20:k].max()):
                out.iloc[k] = True
        return out


class Base52wProximityStrategy(_DailyBreakoutBase):
    strategy_id = "base_52w"
    lookback_min = 260

    @classmethod
    def get_name(cls) -> str:
        return "BASELINE: 52w proximity (within 2%, no vol filter)"

    @classmethod
    def get_description(cls) -> str:
        return "Baseline: close within 2% under prior 252d high, no filters."

    def signal_mask(self, df: pd.DataFrame) -> pd.Series:
        out = pd.Series(False, index=df.index)
        highs = df["high"].astype(float)
        closes = df["close"].astype(float)
        for k in range(252, len(df)):
            sdate = df["_sess"].iloc[k]
            if not (SIG_START <= sdate <= SIG_END):
                continue
            prior = float(highs.iloc[k - 252:k].max())
            if prior <= 0:
                continue
            gap = (prior - float(closes.iloc[k])) / prior
            if 0 <= gap <= 0.02:
                out.iloc[k] = True
        return out

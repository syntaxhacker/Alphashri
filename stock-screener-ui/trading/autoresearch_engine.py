"""Autoresearch engine — automated multi-symbol parameter sweep.

Design:
- A "session" is a named grid sweep:  grid(params) x symbols.
- Each candidate config is run against every symbol via the strategy sim,
  aggregated into combined metrics (profit_factor primary) + per-symbol metrics.
- Results persist to experiments/sessions/<session>.jsonl (config header first
  line, one result line per run — same protocol as the existing autoresearch).
- Live progress is mirrored to Redis key experiment:{user_id}:{session}:status.
- Runs cooperatively as an asyncio task (await asyncio.sleep(0) between
  candidates) so the API stays responsive; supports pause/resume/cancel.
"""
from __future__ import annotations

import asyncio
import itertools
import json
import os
import time
from pathlib import Path
from typing import Callable, Dict, List, Optional

from trading.autoresearch_strategies import STRATEGY_SIMS, get_strategy_defaults
from experiments.newgen.common import compute_metrics

SESSIONS_DIR = Path("experiments/sessions")
MAX_CANDIDATES = 500


def _sanitize(obj):
    """Recursively coerce numpy types / sets to JSON-safe python types."""
    import numpy as np
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, (set,)):
        return sorted(obj)
    return obj


def build_grid(param_space: Dict[str, List]) -> List[Dict]:
    """Cartesian product of param value lists. Each entry = one config dict.

    Scalar values (non-list) are treated as a single-element list so the same
    structure can carry both fixed params and swept params.
    """
    if not param_space:
        return [{}]
    keys = list(param_space.keys())
    lists = [param_space[k] if isinstance(param_space[k], list) else [param_space[k]]
             for k in keys]
    configs = []
    for combo in itertools.product(*lists):
        configs.append({k: v for k, v in zip(keys, combo)})
    return configs


def aggregate_metrics(per_symbol: Dict[str, dict], trades_map: Dict[str, list] | None = None) -> Dict:
    """Combine per-symbol metrics into one aggregate.

    Uses pooled raw trades when available for an accurate profit factor;
    otherwise falls back to net-based aggregation across symbols.
    """
    all_trades_count = sum(m["total_trades"] for m in per_symbol.values())
    if all_trades_count == 0:
        return {
            "total_trades": 0, "wins": 0, "losses": 0, "net_pnl": 0.0,
            "profit_factor": 0.0, "win_rate": 0.0,
            "tp_exits": 0, "sl_exits": 0, "eod_exits": 0,
        }
    wins = sum(m["wins"] for m in per_symbol.values())
    losses = sum(m["losses"] for m in per_symbol.values())
    net = sum(m["net_pnl"] for m in per_symbol.values())
    tp = sum(m["tp_exits"] for m in per_symbol.values())
    sl = sum(m["sl_exits"] for m in per_symbol.values())
    eod = sum(m["eod_exits"] for m in per_symbol.values())

    if trades_map is not None:
        pooled = []
        for trades in trades_map.values():
            pooled.extend(trades)
        if pooled:
            return compute_metrics(pooled)

    # fallback: net-based pooled PF (approximation)
    gross_profit = sum(max(m["net_pnl"], 0) for m in per_symbol.values())
    gross_loss = abs(sum(min(m["net_pnl"], 0) for m in per_symbol.values()))
    pf = round(gross_profit / gross_loss, 4) if gross_loss > 0 else (99.9999 if gross_profit > 0 else 0.0)
    return {
        "total_trades": all_trades_count,
        "wins": wins, "losses": losses,
        "net_pnl": round(net, 2),
        "profit_factor": pf,
        "win_rate": round(wins / all_trades_count * 100, 1) if all_trades_count else 0.0,
        "tp_exits": tp, "sl_exits": sl, "eod_exits": eod,
    }


class ExperimentSession:
    """One named grid-sweep session with JSONL persistence + run numbering."""

    def __init__(self, session: str, user_id: int):
        self.name = session
        self.user_id = user_id
        self.path = SESSIONS_DIR / f"{session}.jsonl"
        self._config_header_written = False

    def ensure_header(self, config_meta: dict):
        if self.path.exists() and not self._config_header_written:
            # Header already exists if file non-empty; do nothing.
            self._config_header_written = True
            return
        if self._config_header_written:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        header = {
            "type": "config",
            "name": self.name,
            "metricName": "profit_factor",
            "metricUnit": "ratio",
            "bestDirection": "higher",
            "symbols": config_meta.get("symbols", []),
            "strategy": config_meta.get("strategy"),
            "tf": config_meta.get("tf"),
            "date_start": config_meta.get("date_start", ""),
            "date_end": config_meta.get("date_end", ""),
            "param_space": config_meta.get("param_space", {}),
            "created_at": time.time(),
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "a") as f:
            f.write(json.dumps(header) + "\n")
        self._config_header_written = True

    def load_runs(self) -> List[Dict]:
        if not self.path.exists():
            return []
        runs = []
        with open(self.path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if obj.get("type") == "config":
                    continue
                runs.append(obj)
        return runs

    def next_run_number(self) -> int:
        return len(self.load_runs()) + 1

    def append_result(self, result: Dict):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(result, default=str) + "\n"
        # atomic append (write temp, rename) to avoid partial lines on crash
        tmp = self.path.with_suffix(".jsonl.tmp")
        with open(tmp, "a") as f:
            f.write(line)
        with open(self.path, "a") as f:
            f.write(line)
        tmp.unlink(missing_ok=True)


class AutoresearchEngine:
    """Runs a session's grid as an asyncio task with pause/resume/cancel."""

    def __init__(self, data_loader: Callable[[int], Dict[str, object]]):
        self.data_loader = data_loader  # tf -> {symbol: df}
        self._tasks: Dict[str, asyncio.Task] = {}
        self._status: Dict[str, Dict] = {}
        self._paused: Dict[str, asyncio.Event] = {}
        self._cancel: Dict[str, bool] = {}

    # -- status -----------------------------------------------------------
    def _status_key(self, session: str, user_id: int) -> str:
        return f"experiment:{user_id}:{session}:status"

    def _update_status(self, session: str, user_id: int, **fields):
        self._status[session] = {**self._status.get(session, {}), **fields}
        self._status[session]["updated_at"] = time.time()
        try:
            from cache.redis_client import get_redis_client
            client = get_redis_client()
            if client:
                client.set(self._status_key(session, user_id),
                           json.dumps(self._status[session], default=str), ex=86400)
        except Exception:
            pass

    def get_status(self, session: str, user_id: int) -> Dict:
        # prefer redis (survives restart), fall back to in-mem
        try:
            from cache.redis_client import get_redis_client
            client = get_redis_client()
            if client:
                raw = client.get(self._status_key(session, user_id))
                if raw:
                    return json.loads(raw)
        except Exception:
            pass
        return self._status.get(session, {"status": "idle", "current": 0, "total": 0})

    def is_running(self, session: str) -> bool:
        task = self._tasks.get(session)
        return task is not None and not task.done()

    def is_paused(self, session: str) -> bool:
        ev = self._paused.get(session)
        return ev is not None and not ev.is_set()

    # -- lifecycle --------------------------------------------------------
    def start(self, session: str, user_id: int, strategy: str, symbols: List[str],
              tf: int, param_space: Dict[str, List], date_start: str = "",
              date_end: str = "", include_costs: bool = True,
              description: str = "") -> Dict:
        if self.is_running(session):
            return {"error": f"Session '{session}' already running"}
        configs = build_grid(param_space)
        if not configs:
            return {"error": "Empty param space"}
        if len(configs) > MAX_CANDIDATES:
            return {"error": f"Grid too large: {len(configs)} candidates (max {MAX_CANDIDATES})"}
        if not symbols:
            return {"error": "No symbols provided"}
        if strategy not in STRATEGY_SIMS:
            return {"error": f"Unknown strategy: {strategy}"}

        self._paused[session] = asyncio.Event()
        self._paused[session].set()
        self._cancel[session] = False

        meta = {
            "strategy": strategy, "symbols": symbols, "tf": tf,
            "date_start": date_start, "date_end": date_end,
            "param_space": param_space, "include_costs": include_costs,
            "description": description,
        }
        self._update_status(session, user_id, status="running", current=0,
                            total=len(configs), strategy=strategy,
                            symbols=symbols, tf=tf, best_pf=0.0,
                            best_desc="", last_result=None)

        task = asyncio.create_task(self._run(session, user_id, configs, meta))
        self._tasks[session] = task
        return {"status": "started", "session": session, "total": len(configs)}

    def pause(self, session: str, user_id: int) -> Dict:
        ev = self._paused.get(session)
        if ev is None:
            return {"error": f"Session '{session}' not running"}
        ev.clear()
        self._update_status(session, user_id, status="paused")
        return {"status": "paused", "session": session}

    def resume(self, session: str, user_id: int) -> Dict:
        ev = self._paused.get(session)
        if ev is None:
            return {"error": f"Session '{session}' not running"}
        ev.set()
        self._update_status(session, user_id, status="running")
        return {"status": "resumed", "session": session}

    def cancel(self, session: str, user_id: int) -> Dict:
        self._cancel[session] = True
        ev = self._paused.get(session)
        if ev is not None:
            ev.set()
        task = self._tasks.get(session)
        if task:
            task.cancel()
        self._update_status(session, user_id, status="cancelled")
        return {"status": "cancelled", "session": session}

    # -- core loop ----------------------------------------------------------
    async def _run(self, session: str, user_id: int, configs: List[Dict], meta: Dict):
        es = ExperimentSession(session, user_id)
        es.ensure_header(meta)
        try:
            # resume: skip configs already logged
            done_descs = {r.get("description") for r in es.load_runs()}
            pending = [c for c in configs if self._config_desc(c) not in done_descs]

            best_pf = 0.0
            best_desc = ""
            current = 0
            for cfg in pending:
                if self._cancel.get(session):
                    self._update_status(session, user_id, status="cancelled", current=current)
                    return
                await self._paused[session].wait()

                desc = self._config_desc(cfg)
                per_symbol, combined, trades_map = self._evaluate(session, cfg, meta)

                run_num = es.next_run_number()
                status = "keep" if combined["profit_factor"] > best_pf else "discard"
                if combined["profit_factor"] > best_pf:
                    best_pf = combined["profit_factor"]
                    best_desc = desc
                elif best_pf == 0:
                    best_pf = combined["profit_factor"]

                result = {
                    "run": run_num,
                    "commit": _head_short(),
                    "metric": combined["profit_factor"],
                    "metrics": combined,
                    "per_symbol": per_symbol,
                    "config": cfg,
                    "strategy": meta["strategy"],
                    "symbols": meta["symbols"],
                    "tf": meta["tf"],
                    "status": status,
                    "description": desc,
                    "timestamp": time.time(),
                    "segment": 0,
                }
                es.append_result(_sanitize(result))
                current += 1
                self._update_status(session, user_id, status="running", current=current,
                                    best_pf=best_pf, best_desc=best_desc,
                                    last_result={"run": run_num, "pf": combined["profit_factor"],
                                                 "trades": combined["total_trades"], "desc": desc})
                await asyncio.sleep(0)

            self._update_status(session, user_id, status="completed", current=len(pending),
                                best_pf=best_pf, best_desc=best_desc)
        except asyncio.CancelledError:
            self._update_status(session, user_id, status="cancelled")
            raise
        except Exception as e:
            import traceback
            traceback.print_exc()
            self._update_status(session, user_id, status="error", error=str(e))
        finally:
            self._tasks.pop(session, None)

    def _config_desc(self, cfg: Dict) -> str:
        return " ".join(f"{k}={v}" for k, v in sorted(cfg.items()))

    def _evaluate(self, session: str, cfg: Dict, meta: Dict):
        """Run one config across all symbols. Returns (per_symbol, combined, trades_map)."""
        strategy = meta["strategy"]
        tf = meta["tf"]
        sim = STRATEGY_SIMS[strategy]
        per_symbol = {}
        trades_map = {}
        try:
            data = self.data_loader(tf)
        except Exception as e:
            data = {}
        for sym in meta["symbols"]:
            df = data.get(sym)
            if df is None or len(df) < 30:
                per_symbol[sym] = compute_metrics([])
                trades_map[sym] = []
                continue
            params = {**cfg, "symbol": sym, "include_costs": meta.get("include_costs", True)}
            try:
                trades = sim(df, params)
            except Exception as e:
                trades = []
            m = compute_metrics(trades)
            per_symbol[sym] = m
            trades_map[sym] = trades
        combined = aggregate_metrics(per_symbol, trades_map)
        return per_symbol, combined, trades_map

    def rerun_for_chart(self, session: str, user_id: int, run_id: int, symbol: str):
        """Re-run a single logged config for chart data (candles + trades)."""
        es = ExperimentSession(session, user_id)
        runs = es.load_runs()
        target = next((r for r in runs if r.get("run") == run_id), None)
        if not target:
            return {"error": f"Run {run_id} not found"}
        cfg = target.get("config", {})
        meta = {
            "strategy": target.get("strategy", ""),
            "symbols": [symbol],
            "tf": target.get("tf", 5),
            "include_costs": True,
        }
        per_symbol, combined, trades_map = self._evaluate(session, cfg, meta)
        return {
            "run": run_id,
            "config": cfg,
            "symbol": symbol,
            "metrics": per_symbol.get(symbol, compute_metrics([])),
            "combined": combined,
            "trades": trades_map.get(symbol, []),
        }


def _head_short() -> str:
    try:
        import subprocess
        return subprocess.check_output(
            ["git", "rev-parse", "--short=7", "HEAD"], stderr=subprocess.DEVNULL
        ).decode().strip() or "unknown"
    except Exception:
        return "unknown"

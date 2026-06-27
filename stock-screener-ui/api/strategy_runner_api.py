"""Strategy Runner API — run multiple bots in parallel, combined JSON summary."""
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel

from trading.runner_core import MultiStrategyRunner
from db.database import SessionLocal
from db.models.bot import BotConfig

router = APIRouter(prefix="/api/strategy-runner", tags=["strategy-runner"])


class StrategyRunnerRequest(BaseModel):
    bot_uuids: list[str]
    date: str
    end_date: Optional[str] = None
    symbols: list[str]


def _run_one_bot(bot_uuid: str, date: str, end_date: str, symbols: list[str]) -> dict:
    """Run replay for one bot in its own thread/DB session. Returns result dict."""
    db = SessionLocal()
    try:
        bot_config = db.query(BotConfig).filter(BotConfig.uuid == bot_uuid).first()
        if not bot_config:
            return {"uuid": bot_uuid, "error": "Bot not found", "trades": 0, "trades_list": []}
        _ = bot_config.strategies  # eager-load

        s = bot_config.strategies[0] if bot_config.strategies else None
        bot_events = []
        runner = MultiStrategyRunner.create_for_replay(bot_config=bot_config)
        runner.run_replay(
            date_str=date, symbols=symbols,
            strategy_filter="ALL", on_event=bot_events.append,
            end_date_str=end_date,
        )

        bot_trades = [e for e in bot_events if e["type"] == "trade_close"]
        for t in bot_trades:
            t["bot_name"] = bot_config.name
            t["bot_uuid"] = bot_uuid

        return {
            "uuid": bot_uuid,
            "name": bot_config.name,
            "strategy_name": s.name if s else "",
            "strategy_type": s.strategy_type if s else "",
            "trades": len(bot_trades),
            "trades_list": bot_trades,
        }
    finally:
        db.close()


@router.post("/run")
def run_strategy_runner(request: Request, body: StrategyRunnerRequest):
    """Run bots in parallel (max 3), return combined JSON summary."""
    max_workers = min(3, len(body.bot_uuids))
    bots_result = []
    all_trades = []

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        fut_map = {
            pool.submit(_run_one_bot, uid, body.date, body.end_date or "", body.symbols): uid
            for uid in body.bot_uuids
        }
        for fut in as_completed(fut_map):
            result = fut.result()
            bots_result.append(result)
            all_trades.extend(result.get("trades_list", []))

    # Combined summary
    result = {"bots": bots_result, "trades": all_trades}

    if all_trades:
        wins = [t for t in all_trades if t.get("pnl", 0) > 0]
        gp = sum(t.get("pnl", 0) for t in wins)
        gl = abs(sum(t.get("pnl", 0) for t in all_trades if t.get("pnl", 0) <= 0))
        net = sum(t.get("pnl", 0) for t in all_trades)

        by_bot = {}
        for t in all_trades:
            bn = t.get("bot_name", "?")
            by_bot.setdefault(bn, {"trades": []})["trades"].append(t)
        for bn, d in by_bot.items():
            bt = d["trades"]; bw = [t for t in bt if t.get("pnl", 0) > 0]
            bgp = sum(t.get("pnl", 0) for t in bw)
            bgl = abs(sum(t.get("pnl", 0) for t in bt if t.get("pnl", 0) <= 0))
            d["summary"] = {"total_trades": len(bt), "winners": len(bw),
                "win_rate": round(len(bw)/len(bt)*100, 1) if bt else 0,
                "net_pnl": round(sum(t.get("pnl", 0) for t in bt), 2),
                "profit_factor": round(bgp/bgl, 4) if bgl > 0 else 0}

        by_sym = {}
        for t in all_trades:
            sym = t.get("symbol", "?")
            d = by_sym.setdefault(sym, {"trades": [], "bots": set()})
            d["trades"].append(t)
            d["bots"].add(t.get("bot_name", "?"))
        symbol_summary = {}
        for sym, d in by_sym.items():
            st = d["trades"]; sw = [t for t in st if t.get("pnl", 0) > 0]
            sgp = sum(t.get("pnl", 0) for t in sw)
            sgl = abs(sum(t.get("pnl", 0) for t in st if t.get("pnl", 0) <= 0))
            bot_pf = {}
            for t in st:
                bn = t.get("bot_name", "?")
                bot_pf[bn] = bot_pf.get(bn, 0) + t.get("pnl", 0)
            symbol_summary[sym] = {"total_trades": len(st), "winners": len(sw),
                "win_rate": round(len(sw)/len(st)*100, 1) if st else 0,
                "net_pnl": round(sum(t.get("pnl", 0) for t in st), 2),
                "profit_factor": round(sgp/sgl, 4) if sgl > 0 else 0,
                "bots_traded": len(d["bots"]), "best_bot": max(bot_pf, key=bot_pf.get) if bot_pf else ""}

        result["summary"] = {
            "total_trades": len(all_trades),
            "winners": len(wins),
            "win_rate": round(len(wins)/len(all_trades)*100, 1) if all_trades else 0,
            "net_pnl": round(net, 2),
            "profit_factor": round(gp/gl, 4) if gl > 0 else 0,
            "by_bot": {k: {"summary": v["summary"]} for k, v in by_bot.items()},
            "by_symbol": symbol_summary,
        }
    else:
        result["summary"] = {"total_trades": 0}

    return result

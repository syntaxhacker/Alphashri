"""Strategy Runner API — run multiple bots, return combined JSON results."""
import json
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


@router.post("/run")
def run_strategy_runner(request: Request, body: StrategyRunnerRequest):
    """Run multiple bots sequentially, return combined JSON summary."""
    try:
        return _run_bots(body)
    except Exception as e:
        import traceback
        traceback.print_exc()
        from fastapi.responses import JSONResponse
        return JSONResponse({"error": str(e)}, status_code=500)


def _run_bots(body: StrategyRunnerRequest) -> dict:
    all_trades = []
    bots_result = []

    for bot_uuid in body.bot_uuids:
        db = SessionLocal()
        try:
            bot_config = db.query(BotConfig).filter(BotConfig.uuid == bot_uuid).first()
            if not bot_config:
                bots_result.append({"uuid": bot_uuid, "error": "Bot not found"})
                continue

            # Eager-load strategies
            _ = bot_config.strategies

            s = bot_config.strategies[0] if bot_config.strategies else None
            bot_events = []
            runner = MultiStrategyRunner.create_for_replay(bot_config=bot_config)
            runner.run_replay(
                date_str=body.date,
                symbols=body.symbols,
                strategy_filter="ALL",
                on_event=bot_events.append,
                end_date_str=body.end_date,
            )

            bot_trades = [e for e in bot_events if e["type"] == "trade_close"]
            for t in bot_trades:
                t["bot_name"] = bot_config.name
                t["bot_uuid"] = bot_uuid
            all_trades.extend(bot_trades)

            bots_result.append({
                "uuid": bot_uuid,
                "name": bot_config.name,
                "strategy_name": s.name if s else "",
                "strategy_type": s.strategy_type if s else "",
                "trades": len(bot_trades),
            })
        finally:
            db.close()

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
                    "net_pnl": round(sum(t.get("pnl", 0) for t in st), 2),
                    "profit_factor": round(sgp/sgl, 4) if sgl > 0 else 0,
                    "bots_traded": len(d["bots"]), "best_bot": max(bot_pf, key=bot_pf.get) if bot_pf else ""}

            result["summary"] = {
                "total_trades": len(all_trades), "winners": len(wins),
                "win_rate": round(len(wins)/len(all_trades)*100, 1) if all_trades else 0,
                "net_pnl": round(net, 2),
                "profit_factor": round(gp/gl, 4) if gl > 0 else 0,
                "by_bot": {k: {"summary": v["summary"]} for k, v in by_bot.items()},
                "by_symbol": symbol_summary,
            }
        else:
            result["summary"] = {"total_trades": 0}

        return result

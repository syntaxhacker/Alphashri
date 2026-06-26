"""Strategy Runner API — run multiple bots on selected symbols, compare results."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

import config
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
async def run_strategy_runner(request: Request, body: StrategyRunnerRequest):
    """Run multiple bots on selected symbols. SSE stream."""

    async def event_stream():
        all_trades = []
        total_bots = len(body.bot_uuids)

        for idx, bot_uuid in enumerate(body.bot_uuids):
            if await request.is_disconnected():
                break

            # Load bot config
            with SessionLocal() as db:
                bot_config = db.query(BotConfig).filter(BotConfig.uuid == bot_uuid).first()
                if not bot_config:
                    yield {"event": "error", "data": json.dumps({"message": f"Bot {bot_uuid} not found"})}
                    continue

            # Emit bot_start
            yield {
                "event": "bot_start",
                "data": json.dumps({
                    "bot_index": idx,
                    "total_bots": total_bots,
                    "bot_uuid": bot_uuid,
                    "bot_name": bot_config.name,
                    "strategy_name": bot_config.strategies[0].name if bot_config.strategies else "",
                }),
            }

            # Run replay for this bot — collect events
            bot_events = []
            def on_event(e):
                bot_events.append(e)

            runner = MultiStrategyRunner.create_for_replay(bot_config=bot_config)
            # Disable consecutive loss limit
            for sid, rnr in runner.strategies.items():
                rnr.config["max_consecutive_losses"] = 0

            try:
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(
                    None,
                    lambda: runner.run_replay(
                        date_str=body.date,
                        symbols=body.symbols,
                        strategy_filter="ALL",
                        on_event=on_event,
                        end_date_str=body.end_date,
                    )
                )
            except Exception as e:
                yield {"event": "error", "data": json.dumps({"message": str(e)})}
                continue

            # Extract trades and summary for this bot
            bot_trades = [e for e in bot_events if e["type"] == "trade_close"]
            bot_summary = next((e for e in bot_events if e["type"] == "summary"), {})
            all_trades.extend(bot_trades)

            # Emit trades for this bot
            for t in bot_trades:
                t["bot_name"] = bot_config.name
                t["bot_uuid"] = bot_uuid
                yield {"event": "trade", "data": json.dumps(t, default=str)}

            # Emit bot_done
            yield {
                "event": "bot_done",
                "data": json.dumps({
                    "bot_index": idx,
                    "bot_uuid": bot_uuid,
                    "bot_name": bot_config.name,
                    "trades": len(bot_trades),
                    "summary": {k: v for k, v in bot_summary.items() if k != "type"} if bot_summary else {},
                }, default=str),
            }

        # Combined summary
        if all_trades:
            wins = [t for t in all_trades if t.get("pnl", 0) > 0]
            losses = [t for t in all_trades if t.get("pnl", 0) <= 0]
            gross_profit = sum(t.get("pnl", 0) for t in wins)
            gross_loss = abs(sum(t.get("pnl", 0) for t in losses))
            net_pnl = sum(t.get("pnl", 0) for t in all_trades)

            # Per-bot breakdown
            by_bot = {}
            for t in all_trades:
                bn = t.get("bot_name", "?")
                if bn not in by_bot:
                    by_bot[bn] = {"trades": [], "summary": {"total_trades": 0, "winners": 0, "losers": 0, "net_pnl": 0, "profit_factor": 0}}
                by_bot[bn]["trades"].append(t)

            for bn, data in by_bot.items():
                bt = data["trades"]
                bw = [t for t in bt if t.get("pnl", 0) > 0]
                bl = [t for t in bt if t.get("pnl", 0) <= 0]
                bgp = sum(t.get("pnl", 0) for t in bw)
                bgl = abs(sum(t.get("pnl", 0) for t in bl))
                data["summary"] = {
                    "total_trades": len(bt),
                    "winners": len(bw),
                    "losers": len(bl),
                    "win_rate": round(len(bw) / len(bt) * 100, 1) if bt else 0,
                    "net_pnl": round(sum(t.get("pnl", 0) for t in bt), 2),
                    "profit_factor": round(bgp / bgl, 4) if bgl > 0 else 0,
                }

            # Per-symbol breakdown
            by_symbol = {}
            for t in all_trades:
                sym = t.get("symbol", "?")
                bn = t.get("bot_name", "?")
                if sym not in by_symbol:
                    by_symbol[sym] = {"trades": [], "bots": set()}
                by_symbol[sym]["trades"].append(t)
                by_symbol[sym]["bots"].add(bn)

            symbol_summary = {}
            for sym, data in by_symbol.items():
                st = data["trades"]
                sw = [t for t in st if t.get("pnl", 0) > 0]
                sl = [t for t in st if t.get("pnl", 0) <= 0]
                sgp = sum(t.get("pnl", 0) for t in sw)
                sgl = abs(sum(t.get("pnl", 0) for t in sl))

                # Best bot for this symbol
                bot_pf = {}
                for t in st:
                    bn = t.get("bot_name", "?")
                    if bn not in bot_pf:
                        bot_pf[bn] = {"pnl": 0, "count": 0}
                    bot_pf[bn]["pnl"] += t.get("pnl", 0)
                    bot_pf[bn]["count"] += 1
                best_bot = max(bot_pf, key=lambda b: bot_pf[b]["pnl"]) if bot_pf else ""

                symbol_summary[sym] = {
                    "total_trades": len(st),
                    "winners": len(sw),
                    "losers": len(sl),
                    "win_rate": round(len(sw) / len(st) * 100, 1) if st else 0,
                    "net_pnl": round(sum(t.get("pnl", 0) for t in st), 2),
                    "profit_factor": round(sgp / sgl, 4) if sgl > 0 else 0,
                    "bots_traded": len(data["bots"]),
                    "total_bots": total_bots,
                    "best_bot": best_bot,
                }

            yield {
                "event": "done",
                "data": json.dumps({
                    "total_trades": len(all_trades),
                    "winners": len(wins),
                    "losers": len(losses),
                    "win_rate": round(len(wins) / len(all_trades) * 100, 1) if all_trades else 0,
                    "net_pnl": round(net_pnl, 2),
                    "profit_factor": round(gross_profit / gross_loss, 4) if gross_loss > 0 else 0,
                    "total_costs": round(sum(t.get("costs", 0) for t in all_trades), 2),
                    "by_bot": by_bot,
                    "by_symbol": symbol_summary,
                }, default=str),
            }
        else:
            yield {
                "event": "done",
                "data": json.dumps({"total_trades": 0, "winners": 0, "losers": 0, "win_rate": 0, "net_pnl": 0, "profit_factor": 0, "total_costs": 0, "by_bot": {}, "by_symbol": {}}),
            }

    return EventSourceResponse(event_stream())

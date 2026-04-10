"""
Telegram Notifier - Sends trade alerts to Telegram for the multi-strategy runner.

All calls are non-blocking (fire-and-forget via thread pool) to avoid
slowing down the scan loop. Failures are logged but never crash the bot.
"""

import os
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

import requests
from rich.console import Console

import config

console = Console()

_ENABLED = os.getenv("TELEGRAM_ENABLED", "true").lower() in ("true", "1", "yes")
_BOT_TOKEN = config.TELEGRAM_CONFIG.get("bot_token", "")
_CHAT_ID = config.TELEGRAM_CONFIG.get("chat_id", "")

if config.ENVIRONMENT == "production" and config.RAILWAY_URL:
    _ORIGIN_TAG = f"🖥️ [{config.RAILWAY_URL}]"
else:
    _ORIGIN_TAG = "🖥️ [LOCAL]"

_API_URL = f"https://api.telegram.org/bot{_BOT_TOKEN}/sendMessage"
_MAX_MSGS_PER_MINUTE = 25
_COOLDOWN_SECONDS = 60

_send_times: deque = deque()
_send_lock = threading.Lock()
_cooldown_keys: Dict[str, float] = {}
_cooldown_lock = threading.Lock()

_THREAD_POOL = ThreadPoolExecutor(max_workers=3)


def _is_available() -> bool:
    if not _ENABLED:
        return False
    if not _BOT_TOKEN or not _CHAT_ID:
        return False
    return True


def _check_rate_limit() -> bool:
    with _send_lock:
        now = time.time()
        while _send_times and _send_times[0] < now - 60:
            _send_times.popleft()
        if len(_send_times) >= _MAX_MSGS_PER_MINUTE:
            return False
        _send_times.append(now)
        return True


def _check_cooldown(key: str) -> bool:
    with _cooldown_lock:
        now = time.time()
        last = _cooldown_keys.get(key, 0)
        if now - last < _COOLDOWN_SECONDS:
            return False
        _cooldown_keys[key] = now
        return True


def _send_message(text: str, cooldown_key: Optional[str] = None) -> None:
    if not _is_available():
        return

    if cooldown_key and not _check_cooldown(cooldown_key):
        console.print("[dim]Telegram: skipped (cooldown)[/dim]")
        return

    if not _check_rate_limit():
        console.print("[dim]Telegram: skipped (rate limit)[/dim]")
        return

    def _do_send():
        try:
            text_with_origin = f"{text}\n\n{_ORIGIN_TAG}"
            resp = requests.post(
                _API_URL,
                json={"chat_id": _CHAT_ID, "text": text_with_origin, "parse_mode": "Markdown"},
                timeout=10,
            )
            if resp.status_code == 200:
                console.print("[green]✅ Telegram sent[/green]")
            else:
                console.print(f"[yellow]Telegram {resp.status_code}: {resp.text[:100]}[/yellow]")
        except Exception as e:
            console.print(f"[red]Telegram error: {e}[/red]")

    try:
        _THREAD_POOL.submit(_do_send)
    except Exception:
        pass


def send_trade_entry(
    bot_name: str,
    strategy_name: str,
    symbol: str,
    side: str,
    price: float,
    quantity: int,
    sl: float,
    tp: float,
) -> None:
    emoji = "🟢" if side.upper() == "BUY" else "🔴"
    direction = "LONG" if side.upper() == "BUY" else "SHORT"
    value = price * quantity

    msg = (
        f"{emoji} *TRADE ENTRY* — {bot_name}\n\n"
        f"*{symbol}* | {direction} | `{strategy_name}`\n"
        f"Entry: ₹{price:.2f} × {quantity} = ₹{value:,.0f}\n"
        f"SL: ₹{sl:.2f} ({abs((sl - price) / price * 100):.2f}%)\n"
        f"TP: ₹{tp:.2f} ({abs((tp - price) / price * 100):.2f}%)\n"
        f"⏰ {datetime.now(config.IST).strftime('%H:%M:%S IST')}"
    )

    _send_message(msg, cooldown_key=f"entry:{symbol}")


def send_trade_exit(
    bot_name: str,
    strategy_name: str,
    symbol: str,
    side: str,
    entry_price: float,
    exit_price: float,
    quantity: int,
    pnl: float,
    pnl_pct: float,
    exit_reason: str,
    entry_time: datetime,
) -> None:
    emoji = "💚" if pnl >= 0 else "❌"
    direction = "LONG" if side.upper() == "BUY" else "SHORT"
    hold = (datetime.now(config.IST) - entry_time.replace(tzinfo=None) if entry_time.tzinfo else entry_time).total_seconds() / 60

    msg = (
        f"{emoji} *TRADE EXIT* — {bot_name}\n\n"
        f"*{symbol}* | {direction} | `{strategy_name}`\n"
        f"Entry: ₹{entry_price:.2f} → Exit: ₹{exit_price:.2f}\n"
        f"P&L: {pnl:+,.2f} ({pnl_pct:+.2f}%)\n"
        f"Reason: *{exit_reason}*\n"
        f"Hold: {hold:.0f}m\n"
        f"⏰ {datetime.now(config.IST).strftime('%H:%M:%S IST')}"
    )

    _send_message(msg, cooldown_key=f"exit:{symbol}")


def send_bot_status(bot_name: str, status: str, details: str = "") -> None:
    icons = {"started": "✅", "stopped": "❌", "error": "⚠️"}
    icon = icons.get(status, "ℹ️")

    msg = f"{icon} *Bot {status.title()}* — {bot_name}"
    if details:
        msg += f"\n{details}"

    _send_message(msg, cooldown_key=f"bot_status:{bot_name}")


def send_daily_summary(
    bot_name: str,
    total_pnl: float,
    win_count: int,
    loss_count: int,
    best_trade: Optional[Dict[str, Any]] = None,
    worst_trade: Optional[Dict[str, Any]] = None,
    open_positions: Optional[list] = None,
) -> None:
    pnl_emoji = "📈" if total_pnl >= 0 else "📉"
    total_trades = win_count + loss_count
    win_rate = (win_count / total_trades * 100) if total_trades > 0 else 0

    msg = (
        f"📊 *Daily Summary* — {bot_name}\n\n"
        f"{pnl_emoji} Net P&L: ₹{total_pnl:+,.0f}\n"
        f"Trades: {total_trades} | Wins: {win_count} | Losses: {loss_count}\n"
        f"Win Rate: {win_rate:.0f}%\n"
    )

    if best_trade:
        msg += f"🏆 Best: {best_trade.get('symbol', '?')} ({best_trade.get('pnl', 0):+.2f}%)\n"
    if worst_trade:
        msg += f"💀 Worst: {worst_trade.get('symbol', '?')} ({worst_trade.get('pnl', 0):+.2f}%)\n"

    if open_positions:
        msg += f"\n📌 *Open Positions ({len(open_positions)})*\n"
        for p in open_positions[:5]:
            unrealized = p.get("unrealized_pnl", 0)
            p_emoji = "📈" if unrealized >= 0 else "📉"
            msg += f"  {p_emoji} {p.get('symbol', '?')}: ₹{unrealized:+,.0f}\n"
        if len(open_positions) > 5:
            msg += f"  ... +{len(open_positions) - 5} more\n"

    msg += f"\n⏰ {datetime.now(config.IST).strftime('%d %b %Y %H:%M IST')}"
    _send_message(msg, cooldown_key=f"daily_summary:{bot_name}")


def send_risk_alert(
    bot_name: str,
    alert_type: str,
    current_value: float,
    threshold: float,
    message: str,
) -> None:
    labels = {
        "daily_loss_approaching": "⚠️ Daily Loss Approaching",
        "max_drawdown_breach": "🚨 Max Drawdown Breach",
        "max_positions_reached": "⚠️ Max Positions Reached",
    }
    title = labels.get(alert_type, f"⚠️ Risk Alert: {alert_type}")

    msg = (
        f"{title}\n"
        f"*{bot_name}*\n\n"
        f"{message}\n"
        f"Current: ₹{current_value:,.0f} / Limit: ₹{threshold:,.0f}\n"
        f"⏰ {datetime.now(config.IST).strftime('%H:%M:%S IST')}"
    )

    _send_message(msg, cooldown_key=f"risk:{bot_name}:{alert_type}")


def send_signal_rejected(
    bot_name: str,
    strategy_name: str,
    symbol: str,
    signal_type: str,
    reason: str,
) -> None:
    msg = (
        f"🚫 *Signal Rejected* — {bot_name}\n\n"
        f"*{symbol}* | {signal_type} | `{strategy_name}`\n"
        f"Reason: {reason}\n"
        f"⏰ {datetime.now(config.IST).strftime('%H:%M:%S IST')}"
    )

    _send_message(msg, cooldown_key=f"rejected:{symbol}")


def send_positions_snapshot(
    bot_name: str,
    positions: list,
    portfolio_status: Dict[str, Any],
) -> None:
    cash = portfolio_status.get("cash", 0)
    capital = portfolio_status.get("initial_capital", 0)
    daily_pnl = portfolio_status.get("daily_pnl", 0)
    total_pnl = portfolio_status.get("total_pnl", 0)

    msg = (
        f"📋 *Positions Snapshot* — {bot_name}\n\n"
        f"Capital: ₹{capital:,.0f}\n"
        f"Cash: ₹{cash:,.0f}\n"
        f"Daily P&L: ₹{daily_pnl:+,.0f}\n"
        f"Total P&L: ₹{total_pnl:+,.0f}\n"
    )

    if positions:
        msg += f"\n*Open ({len(positions)}):*\n"
        for p in positions:
            unrealized = p.get("unrealized_pnl", 0)
            p_emoji = "📈" if unrealized >= 0 else "📉"
            msg += (
                f"  {p_emoji} {p.get('symbol', '?')} {p.get('side', '?')} "
                f"×{p.get('quantity', 0)} @ ₹{p.get('entry_price', 0):.2f} "
                f"→ ₹{p.get('current_price', 0):.2f} ({unrealized:+,.0f})\n"
            )
    else:
        msg += "\nNo open positions."

    msg += f"\n⏰ {datetime.now(config.IST).strftime('%H:%M:%S IST')}"
    _send_message(msg, cooldown_key=f"snapshot:{bot_name}")

from typing import Callable, Optional, Dict, Any
from rich.console import Console
import requests

console = Console()


def send_telegram_alert(
    alert: Dict[str, Any],
    telegram_config: Dict[str, Any],
    paper_trading_enabled: bool = False,
    trading_action_resolver: Optional[Callable[[Dict[str, Any]], str]] = None,
) -> None:
    """
    Send a Telegram alert for a new event.

    Parameters:
    - alert: dict containing alert details (same structure as original implementation)
    - telegram_config: dict with 'bot_token' and 'chat_id'
    - paper_trading_enabled: whether to append paper trading guidance for non-trade alerts
    - trading_action_resolver: optional function(alert) -> str to provide human-readable action
    """
    try:
        bot_token = telegram_config.get('bot_token')
        chat_id = telegram_config.get('chat_id')
        if not bot_token or not chat_id:
            return

        # Build message (retain exact formatting/branches from original)
        message = f"🔥 *TradingView Alert: {alert['type'].replace('_', ' ').title()}* 🔥\n\n"
        message += f"📈 *Symbol:* {alert['ticker']} ({alert.get('name', alert['ticker'])})\n"
        message += f"💰 *Price:* ₹{alert['price']:.2f}\n"

        if alert['type'] == 'VOLUME_SPIKE':
            message += f"📊 *Volume Ratio:* {alert['current_volume_ratio']:.1f}x (was {alert['previous_volume_ratio']:.1f}x)\n"
            message += f"📈 *Change:* {alert['change']:+.2f}%\n"
        elif alert['type'] == 'PRICE_MOVE':
            message += f"📈 *Change:* {alert['current_change']:+.2f}% (was {alert['previous_change']:+.2f}%)\n"
            message += f"📊 *Volume Ratio:* {alert['volume_ratio']:.1f}x\n"
        elif alert['type'] == 'SMART_FOMO':
            message += f"📊 *Volume Ratio:* {alert['volume_ratio']:.1f}x (FOMO signal)\n"
            message += f"📈 *Change:* {alert['change']:+.2f}%\n"
            message += f"🧠 *Historical Check:* ✅ Upside potential validated\n"
            message += f"🎯 *Strategy:* Smart FOMO (avoid late entries)\n"
        elif alert['type'] == 'TRADE_ENTRY':
            side_emoji = "🟢" if alert['side'] == 'BUY' else "🔴"
            message = f"🎯 *TRADE EXECUTED* 🎯\n\n"
            message += f"{side_emoji} *{alert['side']}* {alert['quantity']} shares of *{alert['ticker']}*\n"
            message += f"💰 *Entry Price:* ₹{alert['price']:.2f}\n"
            message += f"💵 *Amount:* ₹{alert['amount']:,.0f}\n"
            message += f"📊 *Signal:* {alert['alert_type'].replace('_', ' ').title()}\n"
            message += f"🎯 *Confidence:* {alert['confidence']:.0%}\n"
            if alert.get('trend') and alert['trend'] != 'neutral':
                message += f"📈 *Trend:* {alert['trend'].replace('_', ' ').title()}\n"
        elif alert['type'] == 'TRADE_EXIT':
            side_emoji = "🔴" if alert['side'] == 'SELL' else "🟢"
            pnl_emoji = "💚" if alert['pnl_pct'] > 0 else "❌" if alert['pnl_pct'] < 0 else "⚪"
            message = f"🔥 *TRADE CLOSED* 🔥\n\n"
            message += f"{side_emoji} *{alert['side']}* {alert['quantity']} shares of *{alert['ticker']}*\n"
            message += f"📈 *Entry:* ₹{alert['entry_price']:.2f}\n"
            message += f"📉 *Exit:* ₹{alert['exit_price']:.2f}\n"
            message += f"💵 *Amount:* ₹{alert['amount']:,.0f}\n"
            message += f"{pnl_emoji} *P&L:* {alert['pnl_pct']:+.2f}% (₹{alert['pnl_amount']:+,.0f})\n"
            message += f"⏱️ *Hold Time:* {alert['hold_time_minutes']}m\n"
            message += f"📋 *Reason:* {alert['reason']}\n"

        # Add confidence score for non-trade alerts
        if alert['type'] not in ['TRADE_ENTRY', 'TRADE_EXIT']:
            confidence = alert.get('confidence', 0.5)
            message += f"🎯 *Confidence:* {confidence:.0%}\n"

        # Paper trading guidance for non-trade alerts
        if paper_trading_enabled and alert['type'] not in ['TRADE_ENTRY', 'TRADE_EXIT'] and trading_action_resolver:
            try:
                trading_action = trading_action_resolver(alert)
                message += f"\n💰 *Trading Action:* {trading_action}\n"
                message += f"💵 *Position Size:* ₹20,000"
            except Exception:
                # Resolver is optional; ignore failures
                pass

        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        payload = {
            'chat_id': chat_id,
            'text': message,
            'parse_mode': 'Markdown'
        }

        response = requests.post(url, json=payload, timeout=10)
        if response.status_code == 200:
            console.print(f"[green]✅ Telegram alert sent for {alert['ticker']}[/green]")
        else:
            console.print(f"[red]⚠️ Telegram alert failed for {alert['ticker']}: {response.text}[/red]")

    except Exception as e:
        console.print(f"[red]❌ Error sending Telegram alert: {str(e)}[/red]")
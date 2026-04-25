from rich.console import Console

console = Console()

try:
    import requests
    import os
    import sys
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from config import TELEGRAM_CONFIG
except ImportError:
    TELEGRAM_CONFIG = None
    requests = None


class TelegramMixin:

    def send_telegram_alert(self, alert):
        if not self.telegram_enabled:
            return

        if not TELEGRAM_CONFIG or not requests:
            return

        try:
            bot_token = TELEGRAM_CONFIG['bot_token']
            chat_id = TELEGRAM_CONFIG['chat_id']

            message = f"🔥 *TradingView Alert: {alert['type'].replace('_', ' ').title()}* 🔥\n\n"
            message += f"📈 *Symbol:* {alert['ticker']} ({alert['name']})\n"
            message += f"💰 *Price:* ₹{alert['price']:.2f}\n"

            if alert['type'] == 'VOLUME_SPIKE':
                message += f"📊 *Volume Ratio:* {alert['current_volume_ratio']:.1f}x (was {alert['previous_volume_ratio']:.1f}x)\n"
                message += f"📈 *Change:* {alert['change']:+.2f}%\n"
            elif alert['type'] == 'PRICE_MOVE':
                message += f"📈 *Change:* {alert['current_change']:+.2f}% (was {alert['previous_change']:+.2f}%)\n"
                message += f"📊 *Volume Ratio:* {alert['volume_ratio']:.1f}x\n"

            if self.paper_trading_enabled:
                trading_action = self._get_trading_action(alert)
                message += f"\n💰 *Trading Action:* {trading_action}\n"
                message += f"💵 *Position Size:* ₹20,000"

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

    def send_telegram_exit_alert(self, message):
        if not self.telegram_enabled:
            return

        if not TELEGRAM_CONFIG or not requests:
            return

        try:
            bot_token = TELEGRAM_CONFIG['bot_token']
            chat_id = TELEGRAM_CONFIG['chat_id']

            url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
            payload = {
                'chat_id': chat_id,
                'text': message,
                'parse_mode': 'Markdown'
            }

            response = requests.post(url, json=payload, timeout=10)
            if response.status_code == 200:
                console.print("[green]✅ Telegram exit alert sent[/green]")
            else:
                console.print(f"[red]⚠️ Telegram exit alert failed: {response.text}[/red]")

        except Exception as e:
            console.print(f"[red]❌ Error sending Telegram exit alert: {str(e)}[/red]")

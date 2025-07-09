import requests
from config import TELEGRAM_CONFIG

def send_telegram_message(message):
    """Sends a message to a Telegram chat."""
    if not TELEGRAM_CONFIG or not TELEGRAM_CONFIG.get('bot_token') or not TELEGRAM_CONFIG.get('chat_id'):
        print("Telegram configuration is missing or incomplete.")
        return

    bot_token = TELEGRAM_CONFIG['bot_token']
    chat_id = TELEGRAM_CONFIG['chat_id']
    
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    
    try:
        response = requests.post(url, json={'chat_id': chat_id, 'text': message})
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"Failed to send Telegram message: {e}")

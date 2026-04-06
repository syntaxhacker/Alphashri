from datetime import datetime

from screeners.tv_display_utils import Colors


class TelegramMixin:

    def log_colored_instance(self, message, level="info"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_message = f"[{timestamp}] {message}"

        if level == "error":
            print(f"{Colors.RED}{log_message}{Colors.RESET}")
        elif level == "success":
            print(f"{Colors.GREEN}{log_message}{Colors.RESET}")
        elif level == "warning":
            print(f"{Colors.YELLOW}{log_message}{Colors.RESET}")
        elif level == "trade":
            print(f"{Colors.CYAN}{log_message}{Colors.RESET}")
        elif level == "profit":
            print(f"{Colors.BG_GREEN}{Colors.BOLD}{log_message}{Colors.RESET}")
        elif level == "loss":
            print(f"{Colors.BG_RED}{Colors.BOLD}{log_message}{Colors.RESET}")
        elif level == "level":
            print(f"{Colors.MAGENTA}{log_message}{Colors.RESET}")
        else:
            print(f"{Colors.WHITE}{log_message}{Colors.RESET}")

    def send_telegram_alert(self, message, level="info"):
        self.log_colored_instance(message, level)

import logging
import os
import threading

logger = logging.getLogger("trading.bot_heartbeat")

HEARTBEAT_INTERVAL = 45
HEARTBEAT_TTL = 90


class BotHeartbeat:
    def __init__(self, user_id: int, bot_config_id: int):
        self._user_id = user_id
        self._bot_config_id = bot_config_id
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)
        self._clear()

    def _run(self) -> None:
        pid = os.getpid()
        status_key = f"bot:{self._user_id}:{self._bot_config_id}:status"
        pid_key = f"bot:{self._user_id}:{self._bot_config_id}:pid"
        status_value = f"running:{pid}"

        while not self._stop_event.is_set():
            try:
                from cache.redis_client import get_redis_client
                client = get_redis_client()
                if client is not None:
                    client.setex(status_key, HEARTBEAT_TTL, status_value)
                    client.setex(pid_key, 86400, str(pid))
            except Exception as e:
                logger.warning("Heartbeat write failed: %s", e)
            self._stop_event.wait(HEARTBEAT_INTERVAL)

    def _clear(self) -> None:
        try:
            from cache.redis_client import get_redis_client
            client = get_redis_client()
            if client is not None:
                uid = self._user_id
                bid = self._bot_config_id
                client.delete(f"bot:{uid}:{bid}:status", f"bot:{uid}:{bid}:pid")
        except Exception as e:
            logger.warning("Heartbeat clear failed: %s", e)

#!/usr/bin/env python3
"""Optional Telegram bridge for the dashboard's live alerts.

Reuses the project's single-source notifier (`trading/telegram_notifier.py`,
driven by `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`) instead of duplicating
Telegram logic. Everything degrades gracefully: if the notifier or its
credentials are missing, `telegram_status()["configured"]` is False and sends
are no-ops — the browser alerts keep working regardless.
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]  # stock-screener-ui

_STATE: dict = {"loaded": False, "mod": None, "err": None}

_KIND = {"flow": "FLOW", "unusual": "UNUSUAL", "darkpool": "DARK POOL"}


def _ensure_config() -> None:
    """The repo has more than one top-level `config.py` on sys.path; make sure
    `import config` inside the notifier resolves to stock-screener-ui/config.py
    (the one that actually loads TELEGRAM_BOT_TOKEN from .env)."""
    cur = sys.modules.get("config")
    try:
        if cur is not None and (cur.TELEGRAM_CONFIG or {}).get("bot_token"):
            return
    except Exception:  # noqa: BLE001
        pass
    path = _ROOT / "config.py"
    if not path.exists():
        return
    try:
        import importlib.util  # noqa: PLC0415

        spec = importlib.util.spec_from_file_location("config", path)
        cfg = importlib.util.module_from_spec(spec)
        sys.modules["config"] = cfg
        spec.loader.exec_module(cfg)
    except Exception:  # noqa: BLE001
        pass


def _load():
    if _STATE["loaded"]:
        return _STATE["mod"]
    _STATE["loaded"] = True
    try:
        if str(_ROOT) not in sys.path:
            sys.path.insert(0, str(_ROOT))
        _ensure_config()
        from trading import telegram_notifier as tn  # noqa: PLC0415

        _STATE["mod"] = tn
    except Exception as exc:  # noqa: BLE001
        _STATE["err"] = type(exc).__name__
        _STATE["mod"] = None
    return _STATE["mod"]


def telegram_configured() -> bool:
    mod = _load()
    try:
        return bool(mod and mod._is_available())
    except Exception:  # noqa: BLE001
        return False


def telegram_status() -> dict:
    _load()
    return {"configured": telegram_configured(), "error": _STATE["err"]}


def _money(v) -> str:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return "?"
    a = abs(x)
    if a >= 1e9:
        return f"${x/1e9:+.2f}B"
    if a >= 1e6:
        return f"${x/1e6:+.1f}M"
    if a >= 1e3:
        return f"${x/1e3:+.0f}K"
    return f"${x:+.0f}"


def format_live_alert(a: dict) -> str:
    """Render one live alert as Telegram Markdown (kept free of breaking chars)."""
    a = a or {}
    parts = [f"⚡ {_KIND.get(a.get('kind'), a.get('kind') or 'ALERT')} · {a.get('ticker') or '?'}"]
    if a.get("type"):
        parts.append(str(a["type"]).upper())
    if a.get("strike") is not None:
        exp = str(a.get("expiry") or "")
        parts.append(f"{a['strike']}{' ' + exp[5:] if exp else ''}")
    parts.append(_money(a.get("premium")))
    if a.get("sweep"):
        parts.append("SWEEP")
    if a.get("side"):
        parts.append(str(a["side"]))
    line = " | ".join(parts)
    rule = f"\n{a.get('rule')}" if a.get("rule") else ""
    return f"{line}{rule}\n{datetime.now(timezone.utc).strftime('%H:%M:%S')} UTC"


def send_test() -> dict:
    """Send a one-off confirmation so the toggle proves the pipe immediately."""
    if not telegram_configured():
        return {"ok": False, "reason": "telegram not configured"}
    mod = _STATE["mod"]
    try:
        mod.send_alert("✅ Unusual Whales dashboard → Telegram connected (test)")
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "reason": type(exc).__name__}


def send_live_alert(a: dict) -> dict:
    if not telegram_configured():
        return {"ok": False, "reason": "telegram not configured"}
    mod = _STATE["mod"]
    try:
        mod.send_alert(format_live_alert(a), cooldown_key=f"uw:{a.get('id')}")
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "reason": type(exc).__name__}


if __name__ == "__main__":
    import json

    print(json.dumps(telegram_status(), indent=2))
    print(format_live_alert({"kind": "flow", "ticker": "NVDA", "type": "call", "strike": 200, "expiry": "2026-10-16", "premium": 1250000, "sweep": True, "side": "bullish", "rule": "RepeatedHits"}))

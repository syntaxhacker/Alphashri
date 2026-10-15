"""EOD digest: plain-text summary of the daily + breakouts reports.

Sent to Telegram once per day at ~15:45 IST on trading days, plus a manual
``POST /api/reports/digest/send`` endpoint.

Fail-soft everywhere: missing payload sections are skipped, Telegram errors
never raise (``send_eod_digest`` returns ``{sent, reason}``).
"""

from __future__ import annotations

import asyncio
import html
import os
from datetime import datetime
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, Query

router = APIRouter(prefix="/api/reports", tags=["reports"])

MAX_CHARS = 1500
DIGEST_HOUR, DIGEST_MINUTE = 15, 45
DIGEST_MINUTES = DIGEST_HOUR * 60 + DIGEST_MINUTE


# ---------------------------------------------------------------------------
# config helpers
# ---------------------------------------------------------------------------

def is_digest_enabled() -> bool:
    return os.getenv("REPORT_DIGEST_ENABLED", "1").lower() not in ("0", "false", "no")


def get_digest_universe() -> str:
    return (os.getenv("REPORT_DIGEST_UNIVERSE", "nifty500") or "nifty500").strip().lower() or "nifty500"


def _today_str() -> str:
    try:
        import config as _cfg

        return datetime.now(_cfg.IST).strftime("%Y-%m-%d")
    except Exception:
        return datetime.now().astimezone().strftime("%Y-%m-%d")


def _now_ist() -> datetime:
    try:
        import config as _cfg

        return datetime.now(_cfg.IST)
    except Exception:
        return datetime.now().astimezone()


# ---------------------------------------------------------------------------
# pure formatting
# ---------------------------------------------------------------------------

def _esc(value: Any) -> str:
    return html.escape(str(value), quote=False)


def _fnum(value: Any) -> Optional[float]:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    import math

    return out if math.isfinite(out) else None


def _breadth_line(breadth: Any) -> Optional[str]:
    if not isinstance(breadth, dict):
        return None
    try:
        adv = int(breadth.get("advances", 0))
        dec = int(breadth.get("declines", 0))
        unch = int(breadth.get("unchanged", 0))
    except (TypeError, ValueError):
        return None
    avg = _fnum(breadth.get("avg_change"))
    avg_s = f"{avg:+.2f}%" if avg is not None else "n/a"
    nh = breadth.get("new_highs", 0)
    nl = breadth.get("new_lows", 0)
    return f"Breadth Adv {adv}/Dec {dec}/Unch {unch} | Avg {avg_s} | New H/L {nh}/{nl}"


def _index_line(daily: dict) -> Optional[str]:
    """Defensive index line — daily payload shape varies, may be absent."""
    for key in ("index", "indices", "market_index", "nifty", "benchmark"):
        val = daily.get(key)
        if val is None:
            continue
        items = val if isinstance(val, list) else [val]
        parts: list[str] = []
        for item in items[:2]:
            if not isinstance(item, dict):
                continue
            name = item.get("name") or item.get("symbol") or key
            chg = _fnum(item.get("change") or item.get("pct_change") or item.get("change_pct"))
            close = _fnum(item.get("close") or item.get("value") or item.get("price"))
            bit = _esc(name)
            if close is not None:
                bit += f" {close:,.2f}"
            bit += f" ({chg:+.2f}%)" if chg is not None else ""
            parts.append(bit)
        if parts:
            return "Index " + ", ".join(parts)
    return None


def _leaders_line(daily: dict) -> Optional[str]:
    """Defensive sector/theme leaders line — absent in most payloads."""
    for key in ("sector_leaders", "sectors", "theme_leaders", "themes",
                "sector_moves", "sector_performance"):
        val = daily.get(key)
        if val is None:
            continue
        pairs: list[tuple[str, float]] = []
        if isinstance(val, dict):
            for name, item in val.items():
                chg = _fnum(item.get("change") if isinstance(item, dict) else item)
                if chg is not None:
                    pairs.append((str(name), chg))
        elif isinstance(val, list):
            for item in val:
                if not isinstance(item, dict):
                    continue
                name = item.get("name") or item.get("sector") or item.get("theme")
                chg = _fnum(item.get("change") or item.get("change_pct"))
                if name and chg is not None:
                    pairs.append((str(name), chg))
        if pairs:
            pairs.sort(key=lambda t: t[1], reverse=True)
            top = ", ".join(f"{_esc(n)} {c:+.2f}%" for n, c in pairs[:3])
            label = "Sectors" if "sector" in key else "Themes"
            return f"{label}: {top}"
    return None


def _breakout_rows(brk: Any) -> list[dict]:
    if not isinstance(brk, dict):
        return []
    section = brk.get("breakouts")
    if not isinstance(section, dict):
        return []
    rows = section.get("rows")
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


def _moves_rows(daily: Any, panel: str) -> list[dict]:
    if not isinstance(daily, dict):
        return []
    moves = daily.get("moves")
    if not isinstance(moves, dict):
        return []
    rows = moves.get(panel)
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


def format_digest(daily: Optional[dict], brk: Optional[dict], universe: str) -> str:
    """Pure formatter: two payloads -> <1500-char plain-text summary."""
    daily = daily if isinstance(daily, dict) else {}
    brk = brk if isinstance(brk, dict) else {}
    uni = _esc(universe or "nifty500")
    date = _esc(daily.get("date") or brk.get("date") or _today_str())

    lines = [f"EOD Digest {date} ({uni})"]

    breadth = _breadth_line(daily.get("breadth"))
    if breadth:
        lines.append(breadth)

    index = _index_line(daily)
    if index:
        lines.append(index)

    rows = _breakout_rows(brk)[:5]
    if rows:
        bits = []
        for r in rows:
            sym = _esc(r.get("symbol", "?"))
            typ = _esc(r.get("type", "?"))
            pct = _fnum(r.get("pct_above"))
            vol = _fnum(r.get("volume_ratio"))
            bit = f"{sym} {typ}"
            bit += f" {pct:+.2f}%" if pct is not None else ""
            bit += f" {vol:.1f}x" if vol is not None else ""
            bits.append(bit)
        total = brk.get("breakouts", {}).get("count", len(rows)) if isinstance(brk.get("breakouts"), dict) else len(rows)
        lines.append(f"Breakouts ({total}): " + "; ".join(bits))
    else:
        lines.append("Breakouts: none")

    gainers = _moves_rows(daily, "gainers")[:5]
    if gainers:
        bits = []
        for r in gainers:
            chg = _fnum(r.get("change"))
            bits.append(f"{_esc(r.get('symbol', '?'))} {chg:+.2f}%" if chg is not None else _esc(r.get("symbol", "?")))
        lines.append("Top gainers: " + ", ".join(bits))

    surge = _moves_rows(daily, "volume_surge")[:5]
    if surge:
        bits = []
        for r in surge:
            sym = _esc(r.get("symbol", "?"))
            sub = _esc(r.get("sub_value", ""))
            chg = _fnum(r.get("change"))
            bit = f"{sym} {sub}".strip()
            if chg is not None:
                bit += f" ({chg:+.2f}%)"
            bits.append(bit)
        lines.append("Vol surge: " + "; ".join(bits))

    leaders = _leaders_line(daily)
    if leaders:
        lines.append(leaders)

    text = "\n".join(lines)
    if len(text) > MAX_CHARS:
        text = text[: MAX_CHARS - 1] + "…"
    return text


# ---------------------------------------------------------------------------
# default fetchers (sync; mirror the endpoint logic without asyncio)
# ---------------------------------------------------------------------------

def _fetch_daily_payload(universe: str) -> Optional[dict]:
    try:
        from api.reports_api import market as _m
        from chart_patterns.universes import get_universe

        allowed = {str(s).upper() for s in get_universe(universe)}
        df = _m._fetch_tv_frame()
        records = _m._frame_to_records(df, allowed)
        return _m._build_payload(_today_str(), universe, records)
    except Exception:
        return None


def _fetch_breakout_payload(universe: str) -> Optional[dict]:
    try:
        from api.reports_api import breakouts as _b

        return _b.serve_report(_today_str(), universe)
    except Exception:
        return None


def build_digest(universe: str = "nifty500", fetchers: Optional[dict] = None) -> str:
    """Build the digest text. ``fetchers`` seam for tests::

        {"daily": fn(universe) -> dict | None,
         "breakouts": fn(universe) -> dict | None}
    """
    uni = (universe or "nifty500").strip().lower() or "nifty500"
    fetchers = fetchers or {}
    daily_fn = fetchers.get("daily") or _fetch_daily_payload
    brk_fn = fetchers.get("breakouts") or _fetch_breakout_payload
    try:
        daily = daily_fn(uni)
    except Exception:
        daily = None
    try:
        brk = brk_fn(uni)
    except Exception:
        brk = None
    return format_digest(daily, brk, uni)


# ---------------------------------------------------------------------------
# telegram send (fail-soft)
# ---------------------------------------------------------------------------

def is_telegram_configured() -> bool:
    """Dynamic re-read (env first, config fallback) — not import-time values."""
    enabled = os.getenv("TELEGRAM_ENABLED", "true").lower() in ("true", "1", "yes")
    if not enabled:
        return False
    token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    chat = os.getenv("TELEGRAM_CHAT_ID", "")
    if not token or not chat:
        try:
            import config as _cfg

            cfg = getattr(_cfg, "TELEGRAM_CONFIG", {}) or {}
            token = token or cfg.get("bot_token", "")
            chat = chat or cfg.get("chat_id", "")
            if not cfg.get("enabled", True):
                return False
        except Exception:
            pass
    return bool(token and chat)


def _default_sender(text: str) -> None:
    from trading import telegram_notifier as _tn

    _tn.send_alert(text)


def send_eod_digest(
    universe: Optional[str] = None,
    fetchers: Optional[dict] = None,
    notifier: Optional[Callable[[str], None]] = None,
) -> dict:
    """Build + send the digest. Never raises; returns ``{sent, reason}``."""
    uni = (universe or "").strip().lower() or get_digest_universe()
    if not is_telegram_configured():
        return {"sent": False, "reason": "unconfigured"}
    try:
        text = build_digest(uni, fetchers=fetchers)
    except Exception as e:
        return {"sent": False, "reason": f"build failed: {e}"}
    try:
        (notifier or _default_sender)(text)
        return {"sent": True, "reason": "ok"}
    except Exception as e:
        return {"sent": False, "reason": f"send failed: {e}"}


# ---------------------------------------------------------------------------
# scheduler
# ---------------------------------------------------------------------------

def _is_trading_day(now: datetime) -> bool:
    if now.weekday() >= 5:
        return False
    try:
        from trading.utils import is_trading_holiday

        return not is_trading_holiday(now)
    except Exception:
        return True


def _at_or_after(now: datetime, hhmm: tuple[int, int] = (DIGEST_HOUR, DIGEST_MINUTE)) -> bool:
    try:
        from trading.utils import at_or_after

        return at_or_after(now, hhmm)
    except Exception:
        return now.hour * 60 + now.minute >= hhmm[0] * 60 + hhmm[1]


def should_fire(now: datetime, last_sent: Optional[str]) -> bool:
    """Pure decision: trading day + past 15:45 + not yet sent today."""
    try:
        if last_sent == now.date().isoformat():
            return False
        if not _is_trading_day(now):
            return False
        return _at_or_after(now)
    except Exception:
        return False


async def report_digest_task(
    *,
    poll_sec: int = 60,
    now_fn: Optional[Callable[[], datetime]] = None,
    send_fn: Optional[Callable[[str], dict]] = None,
    is_trading_day_fn: Optional[Callable[[datetime], bool]] = None,
) -> None:
    """Daily loop: fire once per trading day at/after 15:45 IST.

    Seams (``now_fn``/``send_fn``/``is_trading_day_fn``) exist for tests;
    production wiring uses defaults. Cancel-safe for lifespan shutdown.
    """
    last_sent: Optional[str] = None
    while True:
        try:
            if is_digest_enabled():
                now = now_fn() if now_fn else _now_ist()
                trading_ok = is_trading_day_fn(now) if is_trading_day_fn else _is_trading_day(now)
                if (
                    trading_ok
                    and _at_or_after(now)
                    and last_sent != now.date().isoformat()
                ):
                    uni = get_digest_universe()
                    try:
                        if send_fn is not None:
                            result = send_fn(uni)
                        else:
                            result = await asyncio.to_thread(send_eod_digest, uni)
                    except Exception as e:
                        result = {"sent": False, "reason": f"error: {e}"}
                    if not isinstance(result, dict):
                        result = {"sent": False, "reason": "error: bad result"}
                    # Once-per-day: mark on success or when there is nothing
                    # to do (unconfigured). Real errors retry next poll.
                    if result.get("sent") or result.get("reason") == "unconfigured":
                        last_sent = now.date().isoformat()
            await asyncio.sleep(poll_sec)
        except asyncio.CancelledError:
            break
        except Exception:
            try:
                await asyncio.sleep(poll_sec)
            except asyncio.CancelledError:
                break


# ---------------------------------------------------------------------------
# manual endpoint (auth-protected)
# ---------------------------------------------------------------------------

try:
    from api.auth import get_current_user as _get_current_user
except Exception:  # pragma: no cover — import-time fallback, endpoint stays open
    _get_current_user = None  # type: ignore[assignment]


if _get_current_user is not None:
    @router.post("/digest/send")
    async def send_digest_now(
        universe: Optional[str] = Query(default=None),
        user=Depends(_get_current_user),
    ) -> dict:
        try:
            uni = (universe or "").strip().lower() or get_digest_universe()
            result = await asyncio.to_thread(send_eod_digest, uni)
            if not isinstance(result, dict):
                return {"sent": False, "reason": "error: bad result"}
            return {"sent": bool(result.get("sent")), "reason": str(result.get("reason", ""))}
        except Exception as e:
            return {"sent": False, "reason": f"error: {e}"}
else:  # pragma: no cover
    @router.post("/digest/send")
    async def send_digest_now(universe: Optional[str] = Query(default=None)) -> dict:  # type: ignore[no-redef]
        try:
            uni = (universe or "").strip().lower() or get_digest_universe()
            result = await asyncio.to_thread(send_eod_digest, uni)
            if not isinstance(result, dict):
                return {"sent": False, "reason": "error: bad result"}
            return {"sent": bool(result.get("sent")), "reason": str(result.get("reason", ""))}
        except Exception as e:
            return {"sent": False, "reason": f"error: {e}"}

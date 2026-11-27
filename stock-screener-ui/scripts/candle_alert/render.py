from datetime import datetime, timedelta

from . import session, sessions
from .clock import format_hms, next_close, seconds_until
from .config import ALERT_LEAD_SECONDS, SYMBOLS, TIMEFRAMES, is_ist, tf_label
from .quotes import Quote, change_pair
from .session import IST

_PREV_FIELD = {"1H": "prev_1h", "4H": "prev_4h"}
_RANGE_FIELDS = {
    "1H": ("low_1h", "high_1h"),
    "4H": ("low_4h", "high_4h"),
}

COLUMN_HEADER = (
    f"{'SYMBOL':<9} {'TF':<4}"
    f"{'CLOSES AT':<14}"
    f"{'TIME LEFT':<15}"
    f"{'CANDLE%':<15}"
    f"{'VS PRIOR RANGE':<19}"
    f"{'LAST PRICE':<15}"
    f"{'PRIOR CLOSE':<16}"
    f"CHANGE abs/%"
)


def _money(value: float) -> str:
    return f"{value:,.2f}"


def _change_text(change: float, percent: float) -> str:
    return f"{change:+,.2f} ({percent:+.2f}%)"


def time_near_percent(tf_minutes: int, remaining_seconds: float) -> float:
    elapsed = tf_minutes * 60 - remaining_seconds
    return max(0.0, min(100.0, elapsed / (tf_minutes * 60) * 100))


def price_near(price: float, low: float, high: float) -> tuple[float, str]:
    if high <= low:
        return 50.0, "MID"
    position = max(0.0, min(100.0, (price - low) / (high - low) * 100))
    side = "LOW" if position <= 25 else "HIGH" if position >= 75 else "MID"
    return position, side


def build_rows(quotes: dict[str, Quote], now: datetime) -> list[dict]:
    rows = []
    tz_label = None
    display_tz = None
    for label, symbol in SYMBOLS:
        # fetch_quotes keys by label; older callers used the ticker symbol.
        quote = quotes.get(label) or quotes.get(symbol)
        if quote is None:
            continue
        tz_label = "IST"
        display_tz = IST
        for tf in TIMEFRAMES:
            label_tf = tf_label(tf)
            if is_ist(label):
                close = session.next_close_ist(tf, now)
                remaining = (close - now).total_seconds()
            else:
                close = next_close(tf, now)
                remaining = seconds_until(tf, now)
            close_display = close.astimezone(display_tz)
            change, percent = change_pair(quote.price, getattr(quote, _PREV_FIELD[label_tf]))
            low_field, high_field = _RANGE_FIELDS[label_tf]
            near_pct, side = price_near(
                quote.price, getattr(quote, low_field), getattr(quote, high_field)
            )
            rows.append({
                "label": label,
                "tf_label": label_tf,
                "close_str": close_display.strftime("%H:%M"),
                "hms": format_hms(remaining),
                "alert_str": (close_display - timedelta(seconds=ALERT_LEAD_SECONDS)).strftime("%H:%M"),
                "tz_label": tz_label,
                "market": "INDIA" if is_ist(label) else "USA",
                "due": 0 < remaining <= ALERT_LEAD_SECONDS,
                "close_key": int(close.timestamp()),
                "alert_epoch": int(close.timestamp()) - ALERT_LEAD_SECONDS,
                "time_near": time_near_percent(tf, remaining),
                "price_near": near_pct,
                "price_side": side,
                "price": _money(quote.price),
                "prev": _money(getattr(quote, _PREV_FIELD[label_tf])),
                "change_str": _change_text(change, percent),
                "change_pct": percent,
            })
    return rows


def _range_text(row: dict) -> str:
    pct = row["price_near"]
    if pct >= 99.5:
        return f"AT HIGH ({pct:.0f}%)"
    if pct <= 0.5:
        return f"AT LOW ({pct:.0f}%)"
    if row["price_side"] == "MID":
        return f"MID ({pct:.0f}%)"
    return f"NEAR {row['price_side']} ({pct:.0f}%)"


def _list_row(row: dict) -> str:
    return (
        f"{row['label']:<9} {row['tf_label']:<4}"
        f"closes {row['close_str']:<5}  "
        f"left {row['hms']:<8}  "
        f"candle {row['time_near']:>5.1f}%  "
        f"range {row['price_side']:<4} {row['price_near']:>5.1f}%  "
        f"last {row['price']}  prior {row['prev']}  {row['change_str']}"
    )


def render_list(rows: list[dict], now: datetime) -> str:
    lines = [
        f"CANDLE CLOSE BOARD  now {now.astimezone(IST):%H:%M:%S} IST  "
        f"(alert 1 min before close)",
        f"SESSION: {sessions.session_detail(now)}",
        COLUMN_HEADER,
    ]
    current_market = None
    for row in rows:
        if row["market"] != current_market:
            if current_market is not None:
                lines.append("")
            lines.append(f"--- {row['market']} ---")
            current_market = row["market"]
        lines.append(_list_row(row))
    return "\n".join(lines) + "\n"


def render_notification_body(rows: list[dict]) -> str:
    if not rows:
        return ""
    close = datetime.strptime(rows[0]["close_str"], "%H:%M")
    zone = rows[0].get("tz_label", "UTC")
    lines = [f"{rows[0]['tf_label']} closes at {close.strftime('%H:%M')} {zone}", ""]
    lines.extend(
        f"{row['label']:<5} last {row['price']:<12} prior close {row['prev']:<12} "
        f"{row['change_str']:<18} range {_range_text(row)}"
        for row in rows
    )
    return "\n".join(lines) + "\n"

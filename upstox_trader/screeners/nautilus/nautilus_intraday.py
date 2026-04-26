from nautilus_trader.model import Bar


def get_ist_time_from_bar(bar: Bar) -> str:
    """Convert bar timestamp from UTC (Nautilus internal) to IST (HH:MM format).

    Nautilus stores timestamps as unix nanoseconds in UTC.
    Indian market hours (IST): 09:15 - 15:30
    In UTC this is: 03:45 - 10:00
    """
    if bar.ts_event is None:
        return "00:00"

    try:
        ts_ns = int(bar.ts_event)
        ts_sec = ts_ns / 1_000_000_000

        from datetime import datetime, timezone
        dt_utc = datetime.fromtimestamp(ts_sec, tz=timezone.utc)

        from datetime import timedelta
        dt_ist = dt_utc + timedelta(hours=5, minutes=30)

        return dt_ist.strftime("%H:%M")
    except Exception:
        return "00:00"


__all__ = ['get_ist_time_from_bar']

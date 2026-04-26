"""Telegram notification hooks for daily ORB trading runner.

Delegates to trading.telegram_notifier. Call these from the runner
at key lifecycle points (entry, exit, status, summary).
"""

from rich.console import Console

console = Console()


def notify_signal_found(signal):
    """Called when a new ORB signal is detected."""
    _call("send_signal_alert", signal=signal)


def notify_entry(order, signal):
    """Called after a position is opened."""
    _call("send_trade_entry", order=order, signal=signal)


def notify_signal_rejected(signal, reason):
    """Called when risk manager rejects a signal."""
    _call("send_signal_rejected", signal=signal, reason=reason)


def notify_exit(trade, reason):
    """Called after a position is closed."""
    _call("send_trade_exit", trade=trade, reason=reason)


def notify_risk_alert(message):
    """Called when a risk limit is approaching."""
    _call("send_risk_alert", message=message)


def notify_bot_status(runner, started=True):
    """Called when the runner starts or stops."""
    _call("send_bot_status", runner=runner, started=started)


def notify_daily_summary(runner):
    """Called at end of trading day."""
    _call("send_daily_summary", runner=runner)


def notify_positions_snapshot(runner):
    """On-demand positions snapshot."""
    _call("send_positions_snapshot", runner=runner)


def _call(func_name, **kwargs):
    try:
        from trading.telegram_notifier import __dict__ as tn
        fn = tn.get(func_name)
        if fn:
            fn(**kwargs)
    except Exception as e:
        console.print(f"[dim red]Telegram notification error ({func_name}): {e}[/dim red]")

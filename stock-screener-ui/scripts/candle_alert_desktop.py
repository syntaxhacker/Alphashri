#!/usr/bin/env python3
"""Tk desktop window showing candle-close countdowns and firing the alerts."""

import queue
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

import tkinter as tk
from tkinter import messagebox, ttk

sys.path.insert(0, str(Path(__file__).resolve().parent))

from candle_alert import sessions
from candle_alert.config import DEFAULT_QUOTE_TTL_SECONDS, UTC, tf_label
from candle_alert.session import IST
from candle_alert.notifier import notification_title, notify
from candle_alert.quotes import QuoteFetchError, cached_quotes
from candle_alert.render import build_rows, render_notification_body

_REFRESH_MS = 1000
_COLUMNS = (
    ("label", "SYMBOL", 10),
    ("tf_label", "TIMEFRAME", 10),
    ("close_str", "CLOSES AT", 9),
    ("hms", "TIME LEFT", 11),
    ("time_near", "CANDLE %", 11),
    ("price_near", "VS PRIOR RANGE", 14),
    ("price", "LAST PRICE", 13),
    ("prev", "PRIOR CLOSE", 13),
    ("change_str", "CHANGE abs/%", 18),
)
_WIDTHS = {key: width for key, _, width in _COLUMNS}

def _time_text(moment):
    return f"{moment.astimezone(IST):%H:%M:%S} IST"


def _sort_value(row, key):
    if key == "change_str":
        return float(row[key].split()[0].replace("+", ""))
    if key in ("price", "prev"):
        return float(row[key].replace(",", ""))
    return row[key]


def _change_tag(percent):
    if percent >= 1.0:
        return "chg_extreme_up"
    if percent >= 0.25:
        return "chg_up"
    if percent > 0:
        return "chg_slight_up"
    if percent <= -1.0:
        return "chg_extreme_down"
    if percent <= -0.25:
        return "chg_down"
    if percent < 0:
        return "chg_slight_down"
    return "chg_flat"


def _price_tag(side, percent):
    if percent >= 95:
        return "price_extreme_high"
    if percent <= 5:
        return "price_extreme_low"
    return {"LOW": "price_low", "HIGH": "price_high", "MID": "price_mid"}[side]


def _time_tag(percent):
    if percent >= 99:
        return "time_extreme"
    if percent >= 95:
        return "time_hot"
    if percent >= 80:
        return "time_warm"
    return "time_cool"


def _next_alert_text(rows, now):
    upcoming = [row for row in rows if row["alert_epoch"] > now.timestamp()]
    if not upcoming:
        return "NEXT ALERT NOW" if rows else "NEXT ALERT --:--"
    row = min(upcoming, key=lambda item: item["alert_epoch"])
    minutes = max(0, int((row["alert_epoch"] - now.timestamp()) // 60))
    return f"NEXT ALERT {row['alert_str']} {row['tz_label']} (in {minutes}m)"


class CandleAlertApp:
    def __init__(self, root, quote_ttl=DEFAULT_QUOTE_TTL_SECONDS):
        self.root = root
        self.quote_ttl = quote_ttl
        self.quotes = {}
        self.fired = set()
        self.monitoring = True
        self.updates = queue.Queue()
        self.stop_event = threading.Event()
        self.last_update = None
        self.sort_key = None
        self.sort_reverse = False
        self._build_ui()
        threading.Thread(target=self._fetch_loop, daemon=True).start()
        self._refresh()

    def _build_ui(self):
        self.root.title("Alphashri - Candle Close Alerts")
        self.root.geometry("1100x300")
        self.root.configure(bg="#13161C")

        header = tk.Frame(self.root, bg="#13161C")
        header.pack(fill="x", padx=12, pady=(10, 6))
        self.clock_var = tk.StringVar(value="--:--:-- IST")
        self.next_alert_var = tk.StringVar(value="NEXT ALERT --:--")
        self.state_var = tk.StringVar(value="LIVE")
        self.session_var = tk.StringVar(value="SESSION: --")
        tk.Label(header, text="CANDLE CLOSE BOARD", bg="#13161C", fg="#E6E9EF",
                 font=("Monospace", 14, "bold")).pack(side="left")
        self.session_label = tk.Label(header, textvariable=self.session_var,
                                      bg="#13161C", fg="#6B7688",
                                      font=("Monospace", 11, "bold"))
        self.session_label.pack(side="left", padx=14)
        self.state_label = tk.Label(header, textvariable=self.state_var, bg="#13161C",
                                    fg="#16A34A", font=("Monospace", 11, "bold"))
        self.state_label.pack(side="left", padx=14)
        tk.Label(header, textvariable=self.next_alert_var, bg="#13161C", fg="#F59E0B",
                 font=("Monospace", 11)).pack(side="left", padx=10)
        tk.Label(header, textvariable=self.clock_var, bg="#13161C", fg="#93A0B4",
                 font=("Monospace", 11)).pack(side="right")

        header_row = tk.Frame(self.root, bg="#2C313B")
        header_row.pack(fill="x", padx=12)
        self.sort_var = tk.StringVar(value="")
        for key, title, width in _COLUMNS:
            label = tk.Label(header_row, text=title, width=width, anchor="w", padx=0,
                             bg="#2C313B", fg="#93A0B4", cursor="hand2",
                             font=("Monospace", 11))
            label.pack(side="left")
            label.bind("<Button-1>", lambda event, col=key: self._sort_by(col))
        tk.Label(header_row, textvariable=self.sort_var, bg="#2C313B", fg="#F59E0B",
                 font=("Monospace", 10)).pack(side="right")

        table = tk.Frame(self.root, bg="#13161C")
        table.pack(fill="both", expand=True, padx=12)
        self.text = tk.Text(table, height=9, wrap="none", relief="flat", bd=0,
                            padx=0, pady=0,
                            bg="#1F242D", fg="#E6E9EF", font=("Monospace", 11),
                            insertwidth=0, highlightthickness=0)
        self.text.pack(fill="both", expand=True)
        self.text.tag_configure("time_extreme", foreground="#FF1744",
                                font=("Monospace", 11, "bold"))
        self.text.tag_configure("time_hot", foreground="#DC2626")
        self.text.tag_configure("time_warm", foreground="#F59E0B")
        self.text.tag_configure("time_cool", foreground="#16A34A")
        self.text.tag_configure("price_extreme_low", foreground="#00E676",
                                font=("Monospace", 11, "bold"))
        self.text.tag_configure("price_extreme_high", foreground="#FF1744",
                                font=("Monospace", 11, "bold"))
        self.text.tag_configure("price_low", foreground="#16A34A")
        self.text.tag_configure("price_high", foreground="#DC2626")
        self.text.tag_configure("price_mid", foreground="#93A0B4")
        self.text.tag_configure("chg_extreme_up", foreground="#00E676",
                                font=("Monospace", 11, "bold"))
        self.text.tag_configure("chg_up", foreground="#22C55E")
        self.text.tag_configure("chg_slight_up", foreground="#86EFAC")
        self.text.tag_configure("chg_extreme_down", foreground="#FF1744",
                                font=("Monospace", 11, "bold"))
        self.text.tag_configure("chg_down", foreground="#EF4444")
        self.text.tag_configure("chg_slight_down", foreground="#FCA5A5")
        self.text.tag_configure("chg_flat", foreground="#9CA3AF")
        self.text.tag_configure("section", foreground="#93A0B4",
                                font=("Monospace", 11, "bold"))

        footer = tk.Frame(self.root, bg="#13161C")
        footer.pack(fill="x", padx=12, pady=(8, 4))
        self.status_var = tk.StringVar(value="Loading quotes...")
        tk.Label(footer, textvariable=self.status_var, bg="#13161C", fg="#93A0B4",
                 font=("Monospace", 10)).pack(side="left")
        buttons = tk.Frame(self.root, bg="#13161C")
        buttons.pack(fill="x", padx=12, pady=(0, 10))
        self.toggle_var = tk.StringVar(value="Pause alerts")
        ttk.Button(buttons, textvariable=self.toggle_var,
                   command=self._toggle).pack(side="right", padx=4)
        ttk.Button(buttons, text="Send test notification",
                   command=self._test_notification).pack(side="right", padx=4)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _sort_by(self, key):
        if self.sort_key == key:
            self.sort_reverse = not self.sort_reverse
        else:
            self.sort_key = key
            self.sort_reverse = False
        titles = {key: title for key, title, _ in _COLUMNS}
        arrow = "\u25bc" if self.sort_reverse else "\u25b2"
        self.sort_var.set(f"SORTED BY {titles[self.sort_key]} {arrow}")

    def _sorted_rows(self, rows):
        grouped = {"USA": [], "INDIA": []}
        for row in rows:
            grouped.setdefault(row["market"], []).append(row)
        result = []
        for market in ("USA", "INDIA"):
            group = grouped[market]
            if self.sort_key is None:
                result.extend(group)
            else:
                result.extend(
                    sorted(group, key=lambda row: _sort_value(row, self.sort_key),
                           reverse=self.sort_reverse)
                )
        return result

    def _fetch_loop(self):
        while not self.stop_event.is_set():
            try:
                quotes = cached_quotes(self.quote_ttl, now=time.time())
                self.updates.put(("quotes", quotes))
            except QuoteFetchError as exc:
                self.updates.put(("error", str(exc)))
            self.stop_event.wait(self.quote_ttl)

    def _render_rows(self, rows):
        self.text.configure(state="normal")
        self.text.delete("1.0", "end")
        current_market = None
        for row in rows:
            if row["market"] != current_market:
                if current_market is not None:
                    self.text.insert("end", "\n")
                self.text.insert("end", f"--- {row['market']} ---\n", "section")
                current_market = row["market"]
            widths = _WIDTHS
            self.text.insert(
                "end",
                f"{row['label']:<{widths['label']}}{row['tf_label']:<{widths['tf_label']}}",
            )
            self.text.insert("end", f"{row['close_str']:<{widths['close_str']}}")
            self.text.insert("end", f"{row['hms']:<{widths['hms']}}")

            time_cell = f"{row['time_near']:.1f}%"
            near_cell = f"{row['price_side']} {row['price_near']:.1f}%"
            self.text.insert(
                "end", f"{time_cell:<{widths['time_near']}}", _time_tag(row["time_near"])
            )
            self.text.insert(
                "end", f"{near_cell:<{widths['price_near']}}",
                _price_tag(row["price_side"], row["price_near"]),
            )
            self.text.insert(
                "end",
                f"{row['price']:<{widths['price']}}{row['prev']:<{widths['prev']}}",
            )
            self.text.insert(
                "end", f"{row['change_str']}\n", _change_tag(row["change_pct"])
            )
        self.text.configure(state="disabled")

    def _refresh(self):
        while not self.updates.empty():
            kind, payload = self.updates.get()
            if kind == "quotes":
                self.quotes = payload
                self.last_update = datetime.now(UTC)
            else:
                self.status_var.set(f"Quote fetch failed: {payload}")

        now = datetime.now(UTC)
        session_name = sessions.session_label(now)
        self.session_var.set(f"SESSION: {session_name}")
        self.session_label.config(fg=sessions.session_color(session_name))

        if self.last_update is not None and not self.status_var.get().startswith("Quote fetch"):
            state = "ON" if self.monitoring else "OFF"
            self.status_var.set(
                f"{sessions.session_detail(now)} · quotes {_time_text(self.last_update)} "
                f"· alerts {state}"
            )

        self.clock_var.set(_time_text(now))
        self.state_var.set("LIVE" if self.monitoring else "PAUSED")
        self.state_label.config(fg="#16A34A" if self.monitoring else "#F59E0B")
        if self.quotes:
            rows = self._sorted_rows(build_rows(self.quotes, now))
            self._render_rows(rows)
            self.next_alert_var.set(_next_alert_text(rows, now))

            if self.monitoring:
                groups = {}
                for row in rows:
                    if not row["due"]:
                        continue
                    key = (row["tf_label"], row["close_key"])
                    if key in self.fired:
                        continue
                    self.fired.add(key)
                    groups.setdefault(key, []).append(row)

                for (tf_name, _), group in groups.items():
                    body = render_notification_body(group)
                    title = notification_title(
                        tf_name, labels=[(row["label"], "") for row in group]
                    )
                    self._send(title, body)
                    self.status_var.set(f"{tf_name} alert sent at {_time_text(now)}")
        else:
            self.next_alert_var.set("NEXT ALERT --:--")

        self.root.after(_REFRESH_MS, self._refresh)

    def _send(self, title, body):
        threading.Thread(target=notify, args=(title, body), daemon=True).start()

    def _toggle(self):
        self.monitoring = not self.monitoring
        self.toggle_var.set("Pause alerts" if self.monitoring else "Resume alerts")
        self.status_var.set("Alerts ON" if self.monitoring else "Alerts OFF")

    def _test_notification(self):
        if not self.quotes:
            messagebox.showwarning("No quotes", "Quotes have not loaded yet.")
            return
        rows = build_rows(self.quotes, datetime.now(UTC))
        body = render_notification_body(
            [r for r in rows if r["tf_label"] == tf_label(60)]
        )
        self._send(notification_title(tf_label(60)), body)
        self.status_var.set("Test notification sent")

    def _on_close(self):
        self.stop_event.set()
        self.root.destroy()


def main():
    root = tk.Tk()
    CandleAlertApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()

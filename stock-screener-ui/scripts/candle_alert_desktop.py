#!/usr/bin/env python3
"""Tk desktop window showing candle-close countdowns and firing the alerts."""

import queue
import sys
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

import tkinter as tk
from tkinter import messagebox, ttk

sys.path.insert(0, str(Path(__file__).resolve().parent))

from candle_alert.clock import close_epoch, in_alert_window, next_close
from candle_alert.config import (
    ALERT_LEAD_SECONDS,
    DEFAULT_QUOTE_TTL_SECONDS,
    TIMEFRAMES,
    UTC,
    tf_label,
)
from candle_alert.notifier import notification_title, notify
from candle_alert.quotes import QuoteFetchError, cached_quotes
from candle_alert.render import build_rows, render_notification_body

_REFRESH_MS = 1000
_COLUMNS = (
    ("label", "SYMBOL", 6),
    ("tf_label", "TIMEFRAME", 10),
    ("close_str", "CLOSES AT", 8),
    ("hms", "TIME LEFT", 11),
    ("alert_str", "ALERT AT", 8),
    ("time_near", "CANDLE %", 11),
    ("price_near", "VS PRIOR RANGE", 14),
    ("price", "LAST PRICE", 13),
    ("prev", "PRIOR CLOSE", 13),
    ("change_str", "CHANGE abs/%", 18),
)
_LEGEND = (
    "SORT: click header - up arrow ascending / down arrow descending",
    "CANDLE %: time elapsed - amber >80%, red >95%    "
    "RANGE: last price vs PRIOR candle low-high - LOW green / HIGH red / MID grey",
)


def _sort_value(row, key):
    if key == "change_str":
        return float(row[key].split()[0].replace("+", ""))
    if key in ("price", "prev"):
        return float(row[key].replace(",", ""))
    return row[key]


def _next_alert_text(now):
    upcoming = [
        next_close(tf, now) - timedelta(seconds=ALERT_LEAD_SECONDS)
        for tf in TIMEFRAMES
    ]
    future = [moment for moment in upcoming if moment > now]
    if not future:
        return "NEXT ALERT NOW"
    moment = min(future)
    minutes = max(0, int((moment - now).total_seconds() // 60))
    return f"NEXT ALERT {moment:%H:%M} (in {minutes}m)"


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
        self.header_labels = {}
        self._build_ui()
        threading.Thread(target=self._fetch_loop, daemon=True).start()
        self._refresh()

    def _build_ui(self):
        self.root.title("Alphashri - Candle Close Alerts")
        self.root.geometry("1100x350")
        self.root.configure(bg="#13161C")

        header = tk.Frame(self.root, bg="#13161C")
        header.pack(fill="x", padx=12, pady=(10, 6))
        self.clock_var = tk.StringVar(value="--:--:-- UTC")
        self.next_alert_var = tk.StringVar(value="NEXT ALERT --:--")
        self.state_var = tk.StringVar(value="LIVE")
        tk.Label(header, text="CANDLE CLOSE BOARD", bg="#13161C", fg="#E6E9EF",
                 font=("Monospace", 14, "bold")).pack(side="left")
        self.state_label = tk.Label(header, textvariable=self.state_var, bg="#13161C",
                                    fg="#16A34A", font=("Monospace", 11, "bold"))
        self.state_label.pack(side="left", padx=14)
        tk.Label(header, textvariable=self.next_alert_var, bg="#13161C", fg="#F59E0B",
                 font=("Monospace", 11)).pack(side="left", padx=10)
        tk.Label(header, textvariable=self.clock_var, bg="#13161C", fg="#93A0B4",
                 font=("Monospace", 11)).pack(side="right")

        header_row = tk.Frame(self.root, bg="#2C313B")
        header_row.pack(fill="x", padx=12)
        for key, title, width in _COLUMNS:
            label = tk.Label(header_row, text=title, width=width + 2, anchor="w",
                             bg="#2C313B", fg="#93A0B4", cursor="hand2",
                             font=("Monospace", 11, "bold"))
            label.pack(side="left")
            label.bind("<Button-1>", lambda event, col=key: self._sort_by(col))
            self.header_labels[key] = label

        table = tk.Frame(self.root, bg="#13161C")
        table.pack(fill="both", expand=True, padx=12)
        self.text = tk.Text(table, height=9, wrap="none", relief="flat",
                            bg="#1F242D", fg="#E6E9EF", font=("Monospace", 11),
                            insertwidth=0, highlightthickness=0)
        self.text.pack(fill="both", expand=True)
        self.text.tag_configure("time_hot", foreground="#DC2626")
        self.text.tag_configure("time_warm", foreground="#F59E0B")
        self.text.tag_configure("time_cool", foreground="#16A34A")
        self.text.tag_configure("price_low", foreground="#16A34A")
        self.text.tag_configure("price_high", foreground="#DC2626")
        self.text.tag_configure("price_mid", foreground="#93A0B4")

        footer = tk.Frame(self.root, bg="#13161C")
        footer.pack(fill="x", padx=12, pady=(8, 4))
        self.status_var = tk.StringVar(value="Loading quotes...")
        tk.Label(footer, textvariable=self.status_var, bg="#13161C", fg="#93A0B4",
                 font=("Monospace", 10)).pack(side="left")
        legend = tk.Frame(footer, bg="#13161C")
        legend.pack(side="left", padx=20)
        for line in _LEGEND:
            tk.Label(legend, text=line, bg="#13161C", fg="#6B7688",
                     font=("Monospace", 9), anchor="w").pack(anchor="w")

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
        for col, title, _ in _COLUMNS:
            arrow = ""
            if col == self.sort_key:
                arrow = " \u25bc" if self.sort_reverse else " \u25b2"
            self.header_labels[col].config(text=f"{title}{arrow}")

    def _sorted_rows(self, rows):
        if self.sort_key is None:
            return rows
        return sorted(rows, key=lambda row: _sort_value(row, self.sort_key),
                      reverse=self.sort_reverse)

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
        for row in rows:
            self.text.insert("end", f"{row['label']:<6}{row['tf_label']:<10}")
            self.text.insert("end", f"{row['close_str']:<8}")
            self.text.insert("end", f"{row['hms']:<11}")
            self.text.insert("end", f"{row['alert_str']:<8}")

            time_cell = f"{row['time_near']:.1f}%"
            near_cell = f"{row['price_side']} {row['price_near']:.1f}%"
            time_tag = ("time_hot" if row["time_near"] >= 95 else
                        "time_warm" if row["time_near"] >= 80 else "time_cool")
            price_tag = {
                "LOW": "price_low", "HIGH": "price_high", "MID": "price_mid",
            }[row["price_side"]]
            self.text.insert("end", f"{time_cell:<11}", time_tag)
            self.text.insert("end", f"{near_cell:<14}", price_tag)
            self.text.insert("end", f"{row['price']:<13}{row['prev']:<13}")
            self.text.insert("end", f"{row['change_str']}\n")
        self.text.configure(state="disabled")

    def _refresh(self):
        while not self.updates.empty():
            kind, payload = self.updates.get()
            if kind == "quotes":
                self.quotes = payload
                self.last_update = datetime.now(UTC)
            else:
                self.status_var.set(f"Quote fetch failed: {payload}")

        if self.last_update is not None and not self.status_var.get().startswith("Quote fetch"):
            state = "ON" if self.monitoring else "OFF"
            self.status_var.set(
                f"Quotes updated {self.last_update:%H:%M:%S} UTC - alerts {state}"
            )

        now = datetime.now(UTC)
        self.clock_var.set(f"{now:%H:%M:%S} UTC")
        self.next_alert_var.set(_next_alert_text(now))
        self.state_var.set("LIVE" if self.monitoring else "PAUSED")
        self.state_label.config(fg="#16A34A" if self.monitoring else "#F59E0B")
        if self.quotes:
            rows = self._sorted_rows(build_rows(self.quotes, now))
            self._render_rows(rows)

            if self.monitoring:
                for tf in TIMEFRAMES:
                    if not in_alert_window(tf, now):
                        continue
                    key = (tf, close_epoch(tf, now))
                    if key in self.fired:
                        continue
                    self.fired.add(key)
                    body = render_notification_body(
                        [r for r in rows if r["tf_label"] == tf_label(tf)]
                    )
                    self._send(notification_title(tf_label(tf)), body)
                    self.status_var.set(f"{tf_label(tf)} alert sent at {now:%H:%M:%S} UTC")

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

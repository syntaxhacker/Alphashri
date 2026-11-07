#!/usr/bin/env python3
"""5-second monitor for the MANUAL paper book only.

Fires the armed manual triggers and manages open manual positions through the
existing ``options_paper.manual`` functions. No coded strategies, no broker
orders — paper only. Runs until the 15:30 session close (or until killed).
"""

from __future__ import annotations

import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import config  # noqa: E402
from options_paper import manual  # noqa: E402

LOG = Path("/tmp/opencode/manual_monitor_5s.log")


def log(message: str) -> None:
    line = f"[{datetime.now(config.IST):%H:%M:%S}] {message}"
    print(line, flush=True)
    try:
        with LOG.open("a") as handle:
            handle.write(line + "\n")
    except OSError:
        pass


def main() -> int:
    log("manual 5s monitor started — paper only, no coded strategies")
    while True:
        now = datetime.now(config.IST)
        if (now.hour, now.minute) >= (15, 30):
            log("market close — monitor stop")
            return 0
        try:
            tick = manual._last_tick()
            if tick is not None:
                manual.auto_manage(tick)
                open_positions = manual._load()
                if open_positions:
                    marks = []
                    for pos in open_positions:
                        mark = manual._mark(pos, tick)
                        marks.append(
                            f"{pos.get('opt')}{float(pos.get('strike', 0)):.0f}"
                            f" {pos.get('entry_premium'):.2f}->{mark:.2f}"
                        )
                    log(f"spot={tick.spot:.1f} open={len(open_positions)} " + " | ".join(marks))
                else:
                    log(f"spot={tick.spot:.1f} flat — triggers armed")
        except Exception as exc:  # noqa: BLE001
            log(f"ERR {type(exc).__name__}: {exc}")
        time.sleep(5)


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""NIFTY-only paper loop: max 3 lots, 10s cadence, backend wall triggers.

This is a PAPER simulation. It never talks to a broker. It uses the local
FastAPI paper-trading account for fills and the recorded NIFTY chain for
prices/triggers. The 50k target is a target, not a promise.

Rules:
  SHORT  22,900 PE : spot < 22,900 AND 22,900 put OI falling (support gives way)
  LONG   23,000 CE : spot > 23,000 AND 23,000 call OI falling (cap gives way)
  no trade inside 22,900-23,000
  stop 30% of premium, targets 22,800/22,700/22,650 (short) or 23,200/23,350/23,500 (long)
  daily stop 15k, time stop 15:00 IST, max 3 lots, no averaging
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

API = "http://127.0.0.1:8765"
ROOT = Path(__file__).resolve().parent.parent
TAPE = ROOT / "experiments" / "data" / "nifty_tape"
LOG = Path("/tmp/opencode/paper_nifty_loop.log")
JOURNAL = Path("/tmp/opencode/paper_nifty_journal.jsonl")
LOT_QTY = 225  # 3 NIFTY lots
DAILY_STOP = 15_000.0
TARGET_PROFIT = 50_000.0
POLL_SEC = 10
ENTRY = {
    "SHORT": {"strike": 22900, "option": "PE", "symbol": "NIFTY22900PE"},
    "LONG": {"strike": 23000, "option": "CE", "symbol": "NIFTY23000CE"},
}
# Hold for the 50k target, not the first 22,800/23,200 checkpoint. The paper
# close endpoint closes the whole position, so there is no partial scale-out.
FINAL_TARGET = {"SHORT": 22650, "LONG": 23350}


def now_ist() -> datetime:
    # The machine is in IST; keep the loop simple.
    return datetime.now()


def log(message: str) -> None:
    line = f"{now_ist():%Y-%m-%d %H:%M:%S} {message}"
    print(line, flush=True)
    with LOG.open("a") as handle:
        handle.write(line + "\n")


def journal(event: dict) -> None:
    event["ts"] = now_ist().isoformat()
    with JOURNAL.open("a") as handle:
        handle.write(json.dumps(event, default=str) + "\n")


def http(path: str, method: str = "GET", body: dict | None = None, token: str | None = None) -> dict:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode())


def login() -> str:
    response = http(
        "/api/auth/login",
        "POST",
        {"email": "qa@test.com", "password": "qa123"},
    )
    token = response.get("access_token") or response.get("token")
    if not token:
        raise RuntimeError(f"login failed: {response}")
    return token


def last_chain() -> dict:
    date = now_ist().strftime("%Y-%m-%d")
    path = TAPE / f"{date}.jsonl"
    if not path.exists():
        raise RuntimeError(f"no tape for {date}")
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    if not rows:
        raise RuntimeError(f"empty tape for {date}")
    return rows[-1]


def cell(row: dict, strike: int, option: str) -> tuple[float, float, float]:
    values = (row.get("chain") or {}).get(str(strike)) or [None] * 6
    ltp = values[0] if option == "CE" else values[1]
    oi = values[2] if option == "CE" else values[3]
    vol = values[4] if option == "CE" else values[5]
    return (
        float(ltp) if ltp is not None else 0.0,
        float(oi) if oi is not None else 0.0,
        float(vol) if vol is not None else 0.0,
    )


def wall_snapshot() -> dict:
    row = last_chain()
    spot = float(row.get("spot") or 0)
    ce_ltp, ce_oi, _ = cell(row, 23000, "CE")
    pe_ltp, pe_oi, _ = cell(row, 22900, "PE")
    return {
        "t": row.get("t"),
        "spot": spot,
        "ce_ltp": ce_ltp,
        "ce_oi": ce_oi,
        "pe_ltp": pe_ltp,
        "pe_oi": pe_oi,
        "max_pain": row.get("max_pain"),
        "flip": row.get("flip"),
    }


def main() -> int:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    token = login()
    log("NIFTY paper loop started — 3 lots, 10s cadence, paper only")
    position: dict | None = None
    previous: dict | None = None
    realised = 0.0
    entries = 0

    while True:
        clock = now_ist()
        if clock.hour >= 15 and clock.minute >= 0:
            log("time stop 15:00 — closing paper position if any")
            if position:
                close_paper(token, position, position["last_ltp"], "TIME_STOP")
            break

        try:
            snapshot = wall_snapshot()
        except Exception as exc:  # noqa: BLE001
            log(f"tape read failed: {exc}")
            time.sleep(POLL_SEC)
            continue

        spot = snapshot["spot"]
        ce_oi = snapshot["ce_oi"]
        pe_oi = snapshot["pe_oi"]
        ce_ltp = snapshot["ce_ltp"]
        pe_ltp = snapshot["pe_ltp"]

        if position:
            side = position["side"]
            entry_ltp = position["entry_ltp"]
            current_ltp = pe_ltp if side == "SHORT" else ce_ltp
            position["last_ltp"] = current_ltp
            pnl = (current_ltp - entry_ltp) * LOT_QTY
            pnl -= position["costs"]
            log(
                f"{side} {position['symbol']} entry={entry_ltp:.2f} "
                f"ltp={current_ltp:.2f} pnl={pnl:+.0f} spot={spot:.2f}"
            )
            stop = entry_ltp * 0.70
            final_target = FINAL_TARGET[side]
            target_hit = (
                current_ltp >= position["take"]
                or (spot <= final_target if side == "SHORT" else spot >= final_target)
            )
            if current_ltp <= stop:
                close_paper(token, position, current_ltp, "STOP")
                realised += pnl
                journal({"event": "exit", "reason": "STOP", "pnl": pnl, "side": side})
                position = None
                if realised <= -DAILY_STOP:
                    log(f"daily stop hit: {realised:+.0f}; stopping")
                    break
            elif target_hit:
                close_paper(token, position, current_ltp, "TARGET")
                realised += pnl
                journal({"event": "exit", "reason": "TARGET", "pnl": pnl, "side": side})
                position = None
                if realised >= TARGET_PROFIT:
                    log(f"50k target reached: {realised:+.0f}; stopping")
                    break
            time.sleep(POLL_SEC)
            continue

        if previous is None:
            previous = snapshot
            log(f"watching spot={spot:.2f} ce={ce_ltp:.2f} pe={pe_ltp:.2f} (coil 22,900-23,000)")
            time.sleep(POLL_SEC)
            continue

        # Trigger: price through the wall AND the wall OI falling.
        short_trigger = spot < 22900 and pe_oi < previous["pe_oi"]
        long_trigger = spot > 23000 and ce_oi < previous["ce_oi"]

        if short_trigger or long_trigger:
            side = "SHORT" if short_trigger else "LONG"
            meta = ENTRY[side]
            ltp = pe_ltp if side == "SHORT" else ce_ltp
            if ltp <= 0:
                log(f"{side} trigger but no premium; waiting")
                previous = snapshot
                time.sleep(POLL_SEC)
                continue
            symbol = meta["symbol"]
            stop = round(ltp * 0.70, 2)
            take = round(ltp + TARGET_PROFIT / LOT_QTY, 2)
            try:
                order = http(
                    "/api/paper/order",
                    "POST",
                    {
                        "symbol": symbol,
                        "side": "BUY",
                        "quantity": LOT_QTY,
                        "price": round(ltp, 2),
                        "stop_loss": stop,
                        "take_profit": take,
                    },
                    token,
                )
            except urllib.error.HTTPError as exc:
                log(f"paper order rejected: {exc.code} {exc.read().decode()[:200]}")
                previous = snapshot
                time.sleep(POLL_SEC)
                continue
            except Exception as exc:  # noqa: BLE001
                log(f"paper order failed: {exc}")
                previous = snapshot
                time.sleep(POLL_SEC)
                continue
            entries += 1
            position = {
                "side": side,
                "symbol": symbol,
                "entry_ltp": ltp,
                "last_ltp": ltp,
                "order": order,
                "take": take,
                "costs": 0.0,
            }
            journal({"event": "entry", "side": side, "symbol": symbol, "ltp": ltp, "order": order})
            log(f"PAPER ENTRY {side} {symbol} 3 lots @ {ltp:.2f} stop={stop} target={take}")
        else:
            log(
                f"no trigger spot={spot:.2f} pe_oi={pe_oi/1e6:.2f}M "
                f"ce_oi={ce_oi/1e6:.2f}M (need <22,900 / >23,000 with OI falling)"
            )

        previous = snapshot
        time.sleep(POLL_SEC)

    log(f"loop stopped realised={realised:+.0f} entries={entries}")
    return 0


def close_paper(token: str, position: dict, price: float, reason: str) -> None:
    try:
        result = http(
            "/api/paper/close",
            "POST",
            {"symbol": position["symbol"], "exit_price": round(price, 2), "reason": reason},
            token,
        )
        journal({"event": "close", "reason": reason, "result": result, "side": position["side"]})
        log(f"PAPER EXIT {position['side']} {position['symbol']} @ {price:.2f} {reason} {result}")
    except Exception as exc:  # noqa: BLE001
        log(f"paper close failed: {exc}")


if __name__ == "__main__":
    sys.exit(main())

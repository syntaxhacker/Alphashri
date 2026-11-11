#!/usr/bin/env python3
"""Download EICHERMOT option chain around its last earnings dates.

For each earnings date, picks the nearest listed expiry on/after that date
and pulls the full option chain (CE+PE, OI, IV, Greeks) from Fyers.

Usage:
  FYERS_ACCESS_TOKEN=<token> FYERS_CLIENT_ID=<app_id> \
    python scripts/download_eichermot_earnings_chain.py \
    --dates 2026-01-29,2026-04-29 \
    --out experiments/data/eichermot_earnings_chains/

Token resolution order: --token / FYERS_ACCESS_TOKEN + FYERS_CLIENT_ID
(env), then db/alphashri.db broker_connections table.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from datetime import date, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

DEFAULT_TICKER = "EICHERMOT"
OUT_DIR = REPO_ROOT / "experiments" / "data" / "eichermot_earnings_chains"


def _resolve_token(env_token: str | None, client_id: str | None) -> tuple[str, str]:
    """Return (app_id, access_token) for FYERS.

    Order: explicit args -> env -> db/alphashri.db broker_connections.
    """
    raw = env_token or os.getenv("FYERS_ACCESS_TOKEN")
    app = client_id or os.getenv("FYERS_CLIENT_ID") or os.getenv("FYERS_APP_ID")

    if not raw:
        for path in (REPO_ROOT / "db" / "alphashri.db",
                     REPO_ROOT.parent / "db" / "alphashri.db"):
            if not path.exists():
                continue
            try:
                con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
                row = con.execute(
                    "select access_token from broker_connections "
                    "where broker_name='fyers' order by updated_at desc limit 1"
                ).fetchone()
                con.close()
                if row and row[0]:
                    raw = row[0]
                    break
            except sqlite3.Error:
                continue

    if not raw:
        raise RuntimeError(
            "No FYERS token found. Pass --token/--client-id, set "
            "FYERS_ACCESS_TOKEN + FYERS_CLIENT_ID, or add a row to "
            "db/alphashri.broker_connections."
        )

    if ":" in raw:
        head, _, tail = raw.partition(":")
        if head and tail and (not app or head == app):
            return head, tail
        return (app or head), tail

    if not app:
        raise RuntimeError("Bare FYERS token supplied but FYERS_CLIENT_ID is unset.")
    return app, raw


def _fyers_symbol(ticker: str) -> str:
    t = (ticker or "").upper().strip()
    if ":" in t:
        return t
    return f"NSE:{t}-EQ"


def fetch_chain_for_expiry(model, symbol: str, expiry_epoch: int,
                           strikecount: int = 50, greeks: bool = True) -> dict:
    """Fetch one option chain for a specific expiry epoch."""
    payload: dict = {"symbol": symbol, "strikecount": int(strikecount),
                     "timestamp": int(expiry_epoch)}
    if greeks:
        payload["greeks"] = 1
    resp = model.optionchain(data=payload)
    if not isinstance(resp, dict) or resp.get("s") != "ok":
        raise RuntimeError(f"optionchain failed for {symbol} @ {expiry_epoch}: {resp!r}")
    return resp.get("data") or {}


def list_expiries(model, symbol: str) -> list[dict]:
    """Known expiries for the symbol (nearest first), via a strikecount=1 chain."""
    resp = model.optionchain(data={"symbol": symbol, "strikecount": 1})
    if not isinstance(resp, dict) or resp.get("s") != "ok":
        raise RuntimeError(f"expiry list failed for {symbol}: {resp!r}")
    data = resp.get("data") or {}
    entries = []
    for e in data.get("expiryData") or []:
        if not isinstance(e, dict):
            continue
        raw_date, raw_exp = e.get("date"), e.get("expiry")
        date_str = None
        if raw_date is not None:
            s = str(raw_date).strip()
            if s:
                date_str = s if not s.isdigit() else None
        epoch = None
        if raw_exp is not None:
            try:
                epoch = int(raw_exp)
            except (TypeError, ValueError):
                epoch = None
        if date_str is None and epoch is None:
            continue
        if date_str is None and epoch is not None:
            try:
                date_str = datetime.fromtimestamp(epoch).date().isoformat()
            except (OSError, ValueError, OverflowError):
                date_str = None
        entries.append({"date": date_str, "expiry": epoch,
                        "expiry_flag": e.get("expiry_flag")})
    entries.sort(key=lambda e: (e["expiry"] is None, e["expiry"] or 0))
    return entries


def nearest_expiry_on_or_after(expiries: list[dict], on_or_after: date) -> dict | None:
    """Pick the first expiry whose date >= on_or_after."""
    for e in expiries:
        if not e["date"]:
            continue
        try:
            exp_date = date.fromisoformat(e["date"])
        except ValueError:
            continue
        if exp_date >= on_or_after:
            return e
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ticker", default=DEFAULT_TICKER,
                    help="NSE ticker (default: EICHERMOT)")
    ap.add_argument("--dates", required=True,
                    help="Comma-separated earnings dates (YYYY-MM-DD)")
    ap.add_argument("--out", default=str(OUT_DIR),
                    help="Output directory for JSON chain files")
    ap.add_argument("--token", default=None, help="Fyers access token")
    ap.add_argument("--client-id", default=None, dest="client_id",
                    help="Fyers client/app id")
    ap.add_argument("--strikecount", type=int, default=50,
                    help="Fyers strike count (max 50)")
    ap.add_argument("--no-greeks", action="store_true",
                    help="Skip greeks (delta/gamma/theta/vega/iv)")
    ap.add_argument("--gap", type=float, default=0.8,
                    help="Seconds gap between chain calls (avoid 1015)")
    args = ap.parse_args()

    dates = [d.strip() for d in args.dates.split(",") if d.strip()]
    parsed_dates: list[date] = []
    for d in dates:
        try:
            parsed_dates.append(date.fromisoformat(d))
        except ValueError:
            print(f"[skip] invalid date: {d}", flush=True)
    if not parsed_dates:
        print("[error] no valid earnings dates provided.", flush=True)
        return 2

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    app_id, access_token = _resolve_token(args.token, args.client_id)

    from fyers_apiv3.fyersModel import FyersModel
    model = FyersModel(client_id=app_id, token=access_token)

    symbol = _fyers_symbol(args.ticker)
    print(f"[info] symbol={symbol}  dates={[d.isoformat() for d in parsed_dates]}  out={out_dir}",
          flush=True)

    expiries = list_expiries(model, symbol)
    if not expiries:
        print("[error] no expiries returned by Fyers.", flush=True)
        return 2
    print(f"[info] {len(expiries)} expiries listed, nearest={expiries[0]['date']}",
          flush=True)

    manifest = []
    for ed in parsed_dates:
        pick = nearest_expiry_on_or_after(expiries, ed)
        if pick is None:
            print(f"[warn] {ed.isoformat()}: no expiry on/after date; using nearest "
                  f"{expiries[0]['date']}", flush=True)
            pick = expiries[0]

        print(f"[fetch] {ed.isoformat()} -> expiry {pick['date']} (epoch={pick['expiry']})",
              flush=True)
        try:
            data = fetch_chain_for_expiry(model, symbol, int(pick["expiry"]),
                                          strikecount=args.strikecount,
                                          greeks=not args.no_greeks)
        except Exception as exc:  # noqa: BLE001
            print(f"[error] {ed.isoformat()}: {exc}", flush=True)
            time.sleep(args.gap)
            continue

        tag = f"{args.ticker}_{ed.isoformat()}_exp{pick['date']}"
        p = out_dir / f"chain_{tag}.json"
        payload = {
            "ticker": args.ticker,
            "earnings_date": ed.isoformat(),
            "expiry_date": pick["date"],
            "expiry_epoch": pick["expiry"],
            "symbol": symbol,
            "as_of": datetime.now().astimezone().date().isoformat(),
            "data": data,
        }
        p.write_text(json.dumps(payload, indent=2))
        legs = [r for r in data.get("optionsChain", []) if r.get("option_type") in ("CE", "PE")]
        spot_row = next((r for r in data.get("optionsChain", [])
                         if r.get("option_type") == ""), None)
        spot = spot_row.get("ltp") if spot_row else None
        print(f"[ok] {ed.isoformat()}: {len(legs)} legs, spot={spot}, "
              f"saved -> {p.name}", flush=True)
        manifest.append({
            "earnings_date": ed.isoformat(),
            "expiry_date": pick["date"],
            "file": p.name,
            "legs": len(legs),
            "spot": spot,
            "call_oi": data.get("callOi"),
            "put_oi": data.get("putOi"),
        })
        time.sleep(args.gap)

    manifest_path = out_dir / "_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"[done] {len(manifest)} chain(s) saved to {out_dir}")
    print(f"[done] manifest -> {manifest_path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

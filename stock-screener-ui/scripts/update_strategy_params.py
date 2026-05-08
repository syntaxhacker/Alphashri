#!/usr/bin/env python3
"""
Update strategy configuration parameters via CLI.

Usage:
  # Show current params for all strategies
  python scripts/update_strategy_params.py list

  # Update specific params for a strategy
  python scripts/update_strategy_params.py update "EMA Cross Default" --sl_pct=1.0
  python scripts/update_strategy_params.py update "52W Chaser Swing" --sl_pct=2.0 --tp_pct=3.0 --trailing_stop_pct=2.0

  # Update via API (requires running server + token)
  python scripts/update_strategy_params.py api "EMA Cross Default" --sl_pct=1.0 --token=YOUR_API_TOKEN

  # Bulk update from JSON file
  python scripts/update_strategy_params.py bulk updates.json
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from db.database import SessionLocal
from db.models.bot import StrategyConfig


# Fields that can be updated, grouped by strategy type
COMMON_FIELDS = [
    "sl_pct", "tp_pct", "max_positions", "max_capital_per_trade_pct",
    "cooldown_minutes",
]
ORB_FIELDS = COMMON_FIELDS + [
    "or_minutes", "min_or_range_pct", "max_or_range_pct",
    "breakout_buffer_pct", "enable_shorts", "eod_exit_hour", "eod_exit_minute",
    "max_distance_from_or_pct",
]
SR_FIELDS = COMMON_FIELDS + [
    "pivot_type", "breakout_buffer_pct", "enable_shorts",
]
WEEK52_CHASER_FIELDS = [
    "sl_pct", "tp_pct", "entry_threshold_pct", "trailing_stop_pct",
    "trailing_activation_pct", "max_holding_days", "cooldown_days",
    "enable_trailing_stop", "enable_filters", "max_positions",
]
WEEK52_TARGET_FIELDS = [
    "sl_pct", "tp_pct", "entry_threshold_pct", "trailing_stop_pct",
    "max_holding_days", "cooldown_days",
]
EMA_FIELDS = COMMON_FIELDS + [
    "ema_fast_period", "ema_slow_period", "enable_shorts",
]


def get_strategy_type(name: str) -> str:
    db = SessionLocal()
    try:
        s = db.query(StrategyConfig).filter(StrategyConfig.name == name).first()
        return s.strategy_type if s else ""
    finally:
        db.close()


def cmd_list(args):
    db = SessionLocal()
    try:
        rows = db.query(StrategyConfig).filter(
            StrategyConfig.is_template == False
        ).order_by(StrategyConfig.name).all()

        if not rows:
            print("No strategy variations found.")
            return

        print(f"{'Name':30s} {'Type':18s} {'SL%':>6} {'TP%':>6} {'Trail%':>7} {'Entry%':>7} {'Act%':>6} {'Cooldown':>10} {'MaxPos':>6}")
        print("-" * 103)
        for s in rows:
            d = s.to_dict()
            st = d.get("strategy_type", "")
            cd = d.get("cooldown_minutes") or d.get("cooldown_days", "")
            print(
                f"{s.name:30s} {st:18s}"
                f" {str(d.get('sl_pct', '')):>6s}"
                f" {str(d.get('tp_pct', '')):>6s}"
                f" {str(d.get('trailing_stop_pct', '')):>7s}"
                f" {str(d.get('entry_threshold_pct', '')):>7s}"
                f" {str(d.get('trailing_activation_pct', '')):>6s}"
                f" {str(cd):>10s}"
                f" {str(d.get('max_positions', '')):>6s}"
            )
    finally:
        db.close()


def cmd_update(args):
    if not args.name:
        print("Error: --name is required")
        return

    updates = {}
    for k, v in vars(args).items():
        if v is not None and k not in ("name", "func", "token", "file", "command"):
            updates[k] = v

    if not updates:
        print("No params to update. Pass --sl_pct=1.5 etc.")
        return

    db = SessionLocal()
    try:
        s = db.query(StrategyConfig).filter(
            StrategyConfig.name == args.name,
            StrategyConfig.is_template == False
        ).first()
        if not s:
            print(f"Strategy '{args.name}' not found.")
            return

        for k, v in updates.items():
            setattr(s, k, v)
        db.commit()
        print(f"Updated '{args.name}':")
        for k, v in updates.items():
            print(f"  {k} = {v}")
    finally:
        db.close()


def cmd_api(args):
    """Update via API instead of direct DB."""
    import requests

    if not args.token:
        print("Error: --token required for API updates")
        return

    updates = {}
    for k, v in vars(args).items():
        if v is not None and k not in ("name", "func", "token", "file", "command"):
            updates[k] = v

    if not updates:
        print("No params to update.")
        return

    db = SessionLocal()
    try:
        s = db.query(StrategyConfig).filter(
            StrategyConfig.name == args.name,
            StrategyConfig.is_template == False
        ).first()
        if not s:
            print(f"Strategy '{args.name}' not found.")
            return
        strategy_id = s.uuid
    finally:
        db.close()

    headers = {
        "Authorization": f"Bearer {args.token}",
        "Content-Type": "application/json",
    }
    resp = requests.put(
        f"http://localhost:8765/api/strategies/{strategy_id}",
        json=updates,
        headers=headers,
    )
    if resp.status_code == 200:
        print(f"API updated '{args.name}':")
        for k, v in updates.items():
            print(f"  {k} = {v}")
    else:
        print(f"API error ({resp.status_code}): {resp.text}")


def cmd_bulk(args):
    """Bulk update from JSON file."""
    with open(args.file) as f:
        data = json.load(f)

    db = SessionLocal()
    try:
        for entry in data:
            name = entry.pop("name", None)
            if not name:
                print("Skipping entry with no 'name'")
                continue
            s = db.query(StrategyConfig).filter(
                StrategyConfig.name == name,
                StrategyConfig.is_template == False
            ).first()
            if not s:
                print(f"Strategy '{name}' not found, skipping")
                continue
            for k, v in entry.items():
                setattr(s, k, v)
            print(f"Updated '{name}': {entry}")
        db.commit()
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="Update strategy config params")
    sub = parser.add_subparsers(dest="command")

    # list
    p_list = sub.add_parser("list", help="Show all strategy params")

    def bool_or_none(v):
        if v is None:
            return None
        return v.lower() in ("true", "1", "yes")

    # update (direct DB)
    p_upd = sub.add_parser("update", help="Update strategy params (direct DB)")
    p_upd.add_argument("name", nargs="?", help="Strategy name")
    p_upd.add_argument("--sl_pct", type=float)
    p_upd.add_argument("--tp_pct", type=float)
    p_upd.add_argument("--trailing_stop_pct", type=float)
    p_upd.add_argument("--entry_threshold_pct", type=float)
    p_upd.add_argument("--trailing_activation_pct", type=float)
    p_upd.add_argument("--breakout_buffer_pct", type=float)
    p_upd.add_argument("--min_or_range_pct", type=float)
    p_upd.add_argument("--max_or_range_pct", type=float)
    p_upd.add_argument("--max_capital_per_trade_pct", type=float)
    p_upd.add_argument("--max_daily_loss_pct", type=float)
    p_upd.add_argument("--max_total_exposure_pct", type=float)
    p_upd.add_argument("--risk_per_trade_pct", type=float)
    p_upd.add_argument("--min_trade_value", type=float)
    p_upd.add_argument("--max_trade_value", type=float)
    p_upd.add_argument("--max_distance_from_or_pct", type=float)
    p_upd.add_argument("--or_minutes", type=int)
    p_upd.add_argument("--max_positions", type=int)
    p_upd.add_argument("--cooldown_minutes", type=int)
    p_upd.add_argument("--max_holding_days", type=int)
    p_upd.add_argument("--cooldown_days", type=int)
    p_upd.add_argument("--eod_exit_hour", type=int)
    p_upd.add_argument("--eod_exit_minute", type=int)
    p_upd.add_argument("--ema_fast_period", type=int)
    p_upd.add_argument("--ema_slow_period", type=int)
    p_upd.add_argument("--enable_shorts", type=bool_or_none)
    p_upd.add_argument("--enable_trailing_stop", type=bool_or_none)
    p_upd.add_argument("--enable_filters", type=bool_or_none)
    p_upd.add_argument("--pivot_type", type=str)
    p_upd.add_argument("--description", type=str)

    # api (via HTTP)
    p_api = sub.add_parser("api", help="Update via API (needs auth token)")
    p_api.add_argument("name", help="Strategy name")
    p_api.add_argument("--token", help="Auth token", required=True)
    for name, typ in [
        ("sl_pct", float), ("tp_pct", float), ("trailing_stop_pct", float),
        ("entry_threshold_pct", float), ("trailing_activation_pct", float),
        ("breakout_buffer_pct", float),
        ("max_positions", int), ("cooldown_minutes", int),
        ("max_holding_days", int), ("cooldown_days", int),
        ("enable_shorts", bool_or_none), ("enable_trailing_stop", bool_or_none),
    ]:
        p_api.add_argument(f"--{name}", type=typ)

    # bulk
    p_bulk = sub.add_parser("bulk", help="Bulk update from JSON file")
    p_bulk.add_argument("file", help="Path to JSON file")

    args = parser.parse_args()
    if args.command == "list":
        cmd_list(args)
    elif args.command == "update":
        cmd_update(args)
    elif args.command == "api":
        cmd_api(args)
    elif args.command == "bulk":
        cmd_bulk(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()

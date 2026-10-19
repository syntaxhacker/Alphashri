#!/usr/bin/env python3
"""Create the dedicated options paper-trading account in the DB (insert-only).

This is a thin, safe wrapper around ``options_paper.book.ensure_account``:

* It only **adds** rows (a new user, one bot per strategy, the links).
* It never updates or deletes any existing user, bot, strategy, position or trade.
* Re-running it is a no-op.

Usage
-----
    python scripts/setup_options_paper.py            # create / verify
    python scripts/setup_options_paper.py --dry-run  # show what would happen, roll back
    python scripts/setup_options_paper.py --capital 2500000
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from options_paper import book  # noqa: E402


def main() -> int:
    p = argparse.ArgumentParser(description="Set up the options paper-trading account")
    p.add_argument("--capital", type=float, default=book.INITIAL_CAPITAL)
    p.add_argument("--dry-run", action="store_true",
                   help="roll back at the end (nothing is written)")
    args = p.parse_args()

    res = book.ensure_account(capital=args.capital, dry_run=args.dry_run)
    c = res["created"]
    tag = "DRY RUN" if args.dry_run else "OK"
    print(f"[{tag}] options paper account")
    print(f"  email    : {res['email']}")
    print(f"  user_id  : {res['user_id']}")
    print(f"  capital  : ₹{res['capital']:,.0f}")
    print(f"  created  : user={c['user']} strategies={len(c['strategies'])} bots={len(c['bots'])}")
    if c["strategies"]:
        for s in c["strategies"]:
            print(f"             + {s}")
    if c["bots"]:
        for b in c["bots"]:
            print(f"             + {b}")
    if args.dry_run:
        print("  (rolled back — DB unchanged)")
    else:
        print(f"  password : {book.PASSWORD}")
        print("\nNext: python -m options_paper.runner account")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

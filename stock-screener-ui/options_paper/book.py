"""DB account + trade bookkeeping (insert-only).

Creates a dedicated options paper account and records completed round-trip
trades into the canonical ``trades`` table so they show up in the existing
trade-history UI. **It never updates or deletes existing rows**, and never
writes ``positions`` (whose lifecycle is owned by the equity bot runner).

Every completed trade is also appended to a per-day JSONL journal so the
sandbox has a self-contained audit trail independent of the DB.
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime
from pathlib import Path

import bcrypt

REPO_ROOT = Path(__file__).resolve().parent.parent
JOURNAL_DIR = REPO_ROOT / "options_paper" / "journal"

# --- the dedicated account ------------------------------------------------
EMAIL = "options-paper@alphashri.local"
PASSWORD = "optpaper123"
DISPLAY_NAME = "Options Paper (NIFTY + Stocks)"
INITIAL_CAPITAL = 2_500_000.0

# One bot per strategy -> per-strategy capital bucket + P&L attribution.
STRATEGY_TYPES = {
    "nifty_momentum": "OPT_NIFTY_MOMENTUM",
    "stock_momentum": "OPT_STOCK_MOMENTUM",
    "nifty_vrp": "OPT_NIFTY_VRP",
    "nifty_gap": "OPT_NIFTY_GAP",
    "nifty_wall_bounce": "OPT_NIFTY_WALL",
    "nifty_iv_delta": "OPT_NIFTY_IVDELTA",
    "nifty_open_straddle": "OPT_NIFTY_OPENSTRADDLE",
    "nifty_spot_scalp": "OPT_NIFTY_SPOTSCALP",
}

# --------------------------------------------------------------------------
# Agent-runner identity
# --------------------------------------------------------------------------
# Trades placed by the assistant (or any automated agent) are booked under ONE
# dedicated bot + strategy so they are separable from the per-strategy paper
# bots — "show me what the agent did" is a single filter. The originating
# strategy is preserved in the trade's ``reason`` as ``[<strategy>] ...``.
AGENT_BOT_NAME = "Agent - Options Intraday"
AGENT_STRATEGY_NAME = "OPTPAPER agent_intraday"
AGENT_STRATEGY_TYPE = "OPT_AGENT_INTRADAY"
AGENT_TRADE_TAG = "agent_intraday"

#: Which user *owns* the agent bot. It must be the account you actually log in
#: with, because ``/api/bots`` and ``/api/bots/{id}/trades`` are scoped to the
#: authenticated user — the dedicated paper account (``EMAIL``) can never log in
#: (``.local`` is a reserved TLD and the API rejects it), so agent trades booked
#: under it would be invisible in the app. Override with
#: ``OPTIONS_PAPER_AGENT_OWNER``.
AGENT_OWNER_EMAIL = os.environ.get("OPTIONS_PAPER_AGENT_OWNER", "qa@test.com")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _session():
    from db.database import SessionLocal
    return SessionLocal()


def ensure_account(capital: float = INITIAL_CAPITAL, dry_run: bool = False) -> dict:
    """Get-or-create the options paper user, one bot per strategy, and the links.

    Idempotent: re-running adds nothing. Returns a summary dict.
    """
    from db.models import (User, BotConfig, StrategyConfig, bot_strategies)
    from .strategies import STRATEGY_LABELS

    db = _session()
    created = {"user": False, "bots": [], "strategies": []}
    try:
        user = db.query(User).filter(User.email == EMAIL).first()
        if user is None:
            user = User(
                email=EMAIL, hashed_password=hash_password(PASSWORD),
                display_name=DISPLAY_NAME, is_active=True, is_admin=False,
                initial_capital=capital,
            )
            db.add(user)
            db.flush()
            created["user"] = True

        for sname in STRATEGY_TYPES:
            sname_full = f"OPTPAPER {sname}"
            strat = db.query(StrategyConfig).filter(StrategyConfig.name == sname_full).first()
            if strat is None:
                strat = StrategyConfig(
                    name=sname_full,
                    strategy_type=STRATEGY_TYPES[sname],
                    is_template=False, is_active=True, is_default=False,
                    description=f"Options paper: {STRATEGY_LABELS.get(sname, sname)}",
                    max_positions=3, max_capital_per_trade_pct=0.10,
                    max_daily_loss_pct=0.02, risk_per_trade_pct=0.01,
                )
                db.add(strat)
                db.flush()
                created["strategies"].append(sname_full)

            bot_name = f"OPT Paper - {sname}"
            bot = db.query(BotConfig).filter(
                BotConfig.user_id == user.id, BotConfig.name == bot_name).first()
            if bot is None:
                bot = BotConfig(
                    user_id=user.id, name=bot_name, is_active=True,
                    max_total_positions=3, max_total_capital_pct=0.80,
                    max_daily_loss_pct=0.02, live_trading=False,
                )
                db.add(bot)
                db.flush()
                created["bots"].append(bot_name)

            linked = db.query(bot_strategies).filter(
                bot_strategies.c.bot_id == bot.id,
                bot_strategies.c.strategy_id == strat.id).first()
            if linked is None:
                db.execute(bot_strategies.insert().values(
                    bot_id=bot.id, strategy_id=strat.id,
                    max_positions=3, capital_allocation_pct=0.20))

        # --- the agent runner: one bot + one strategy for ALL agent trades ---
        # The bot is owned by AGENT_OWNER_EMAIL (the account you log in with) so
        # its trades are visible in the app; falls back to the paper account.
        owner = db.query(User).filter(User.email == AGENT_OWNER_EMAIL).first() or user
        agent_strat = db.query(StrategyConfig).filter(
            StrategyConfig.name == AGENT_STRATEGY_NAME).first()
        if agent_strat is None:
            agent_strat = StrategyConfig(
                name=AGENT_STRATEGY_NAME, strategy_type=AGENT_STRATEGY_TYPE,
                is_template=False, is_active=True, is_default=False,
                description="Options paper: trades placed by the agent runner",
                max_positions=3, max_capital_per_trade_pct=0.10,
                max_daily_loss_pct=0.02, risk_per_trade_pct=0.01,
            )
            db.add(agent_strat)
            db.flush()
            created["strategies"].append(AGENT_STRATEGY_NAME)

        agent_bot = db.query(BotConfig).filter(
            BotConfig.user_id == owner.id, BotConfig.name == AGENT_BOT_NAME).first()
        if agent_bot is None:
            agent_bot = BotConfig(
                user_id=owner.id, name=AGENT_BOT_NAME, is_active=True,
                max_total_positions=3, max_total_capital_pct=0.80,
                max_daily_loss_pct=0.02, live_trading=False,
            )
            db.add(agent_bot)
            db.flush()
            created["bots"].append(AGENT_BOT_NAME)

        agent_link = db.query(bot_strategies).filter(
            bot_strategies.c.bot_id == agent_bot.id,
            bot_strategies.c.strategy_id == agent_strat.id).first()
        if agent_link is None:
            db.execute(bot_strategies.insert().values(
                bot_id=agent_bot.id, strategy_id=agent_strat.id,
                max_positions=3, capital_allocation_pct=0.20))

        if dry_run:
            db.rollback()
        else:
            db.commit()
        return {
            "user_id": user.id, "email": EMAIL,
            "capital": capital, "created": created, "dry_run": dry_run,
        }
    finally:
        db.close()


def _lookup(db, email: str) -> tuple[int, dict, dict]:
    from db.models import User, BotConfig, StrategyConfig
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise RuntimeError(f"no account {email}; run `setup` first")
    bots = {b.name: b for b in db.query(BotConfig).filter(BotConfig.user_id == user.id).all()}
    strats = {s.name: s for s in db.query(StrategyConfig).filter(
        StrategyConfig.name.like("OPTPAPER %")).all()}
    return user.id, bots, strats


def _trade_id(row: dict) -> str:
    """``strategy|symbol|entry bar`` — the identity of a completed trade.

    Two strategies may hold the same contract in the same minute, and one
    strategy may re-enter the same contract later; the strategy plus the entry
    bar is what makes a trade unique. This is the same key ``Trade.trade_id``
    exposes, so the DB, the journal and the runner all agree.
    """
    return (f"{row.get('strategy', '')}|{row.get('symbol', '')}|"
            f"{row.get('entry_time', '')}")


def record_trades(trades: list, email: str = EMAIL, journal_date: str | None = None,
                  run_as: str | None = None,
                  journal_replace: set | list | tuple | bool | None = None) -> dict:
    """Insert completed trades into the DB and append the day's JSONL journal.

    ``trades`` is a list of ``options_paper.strategies.Trade`` (or dicts).

    ``run_as="agent"`` books everything under the single agent bot/strategy
    (:data:`AGENT_BOT_NAME` / :data:`AGENT_TRADE_TAG`) instead of the
    per-strategy bots, with the originating strategy moved into ``reason``.
    The owner account falls back to the paper account when the configured
    agent owner does not exist.

    ``journal_replace`` makes the journal a **coherent snapshot** instead of an
    append-only union of passes: the rows for the named strategies are replaced
    by this pass's rows (other books — e.g. the manual ledger — are preserved).
    ``True`` replaces the whole day. ``None`` keeps the historical append mode
    for one-shot callers.
    """
    from db.models import Trade as TradeModel
    from sqlalchemy.exc import IntegrityError
    rows = [t.as_row() if hasattr(t, "as_row") else dict(t) for t in trades]
    # An unpriced trade has no honest P&L — exclude it, never book it at 0.
    unpriced = sum(1 for r in rows if r.get("priced") is False)
    rows = [r for r in rows if r.get("priced") is not False]
    if not rows:
        # An empty re-run is still a statement: with ``journal_replace`` the
        # day's rows for those books are cleared, so a rule change that no
        # longer produces a trade cannot leave the old alternative history.
        if journal_replace is not None and journal_date is not None:
            write_journal(journal_date, [], replace=journal_replace)
        return {"inserted": 0, "skipped": 0, "unpriced": unpriced}
    is_agent = (run_as or "").lower() == "agent"
    db = _session()
    inserted = skipped = 0
    try:
        if is_agent:
            # Agent trades belong to the *visible* owner account, and to the one
            # agent bot/strategy, so they are filterable and show in the app.
            # Fall back to the paper account when the owner does not exist
            # (fresh DB / CI) instead of failing the whole booking.
            try:
                user_id, bots, strats = _lookup(db, AGENT_OWNER_EMAIL)
            except RuntimeError:
                user_id, bots, strats = _lookup(db, email)
        else:
            user_id, bots, strats = _lookup(db, email)
        for r in rows:
            if is_agent:
                src = r.get("strategy", "")
                strategy_name = AGENT_TRADE_TAG
                bot = bots.get(AGENT_BOT_NAME)
                strat = strats.get(AGENT_STRATEGY_NAME)
                reason = f"[{src}] {r.get('reason') or ''}".strip()
            else:
                src = r["strategy"]
                strategy_name = src
                bot = bots.get(f"OPT Paper - {r['strategy']}")
                strat = strats.get(f"OPTPAPER {r['strategy']}")
                reason = r.get("reason") or ""
            entry_time = datetime.fromisoformat(r["entry_time"])
            exit_time = datetime.fromisoformat(r["exit_time"])
            # real stop/target levels from the strategy's sl/tp (percent of
            # premium); previously always written as 0.0
            ep = float(r["entry_premium"])
            sl_pct = float(r.get("sl_pct") or 0.0)
            tp_pct = float(r.get("tp_pct") or 0.0)
            if r["direction"] == "SHORT":
                stop_px = ep * (1 + sl_pct) if sl_pct else 0.0
                take_px = ep * (1 - tp_pct) if tp_pct else 0.0
            else:
                stop_px = ep * (1 - sl_pct) if sl_pct else 0.0
                take_px = ep * (1 + tp_pct) if tp_pct else 0.0
            # Dedupe on the identity of a trade, *including* the source
            # strategy for the agent book: every agent trade shares the
            # strategy_name ``agent_intraday``, so without the reason tag two
            # different strategies entering the same contract at the same bar
            # would collide (and a re-run could double-book).
            base_q = db.query(TradeModel).filter(
                TradeModel.user_id == user_id,
                TradeModel.symbol == r["symbol"],
                TradeModel.entry_time == entry_time,
            )
            if is_agent:
                tag = f"[{src}]"
                exists = any(str(getattr(t, "reason", "") or "").startswith(tag)
                             for t in base_q.all())
            else:
                exists = base_q.filter(
                    TradeModel.strategy_name == strategy_name).first() is not None
            if exists:
                skipped += 1
                continue
            try:
                # A savepoint per row: the schema's unique key (bot, strategy,
                # symbol, entry bar) is narrower than "strategy|symbol|bar" for
                # the single agent bot, so two strategies on the same contract
                # in the same minute collide. One collision must never abort
                # the rest of the pass.
                with db.begin_nested():
                    db.add(TradeModel(
                        user_id=user_id,
                        bot_id=bot.id if bot else None,
                        strategy_id=strat.id if strat else None,
                        strategy_name=strategy_name,
                        symbol=r["symbol"],
                        side="SELL" if r["direction"] == "SHORT" else "BUY",
                        quantity=int(r["qty"]),
                        entry_price=float(r["entry_premium"]),
                        entry_time=entry_time,
                        stop_loss=round(stop_px, 2), take_profit=round(take_px, 2),
                        peak_price=0.0, low_price=0.0,
                        is_test=False,
                        exit_price=float(r["exit_premium"]),
                        exit_time=exit_time,
                        pnl=float(r["gross_pnl"]),
                        pnl_pct=round(float(r["points"]) / float(r["entry_premium"]) * 100.0, 4)
                        if r["entry_premium"] else 0.0,
                        costs=float(r["costs"]),
                        net_pnl=float(r["net_pnl"]),
                        exit_reason=r["exit_reason"],
                        source="options_paper_agent" if is_agent else "options_paper",
                        reason=reason[:500],
                        notes=f"{r['opt']} x{r['lots']} lot={r['lot']} pts={r['points']}",
                    ))
                    db.flush()
            except IntegrityError:
                skipped += 1
                continue
            inserted += 1
        db.commit()
    finally:
        db.close()

    if journal_date is None:
        journal_date = rows[0]["entry_time"][:10]
    write_journal(journal_date, rows, replace=journal_replace)
    return {"inserted": inserted, "skipped": skipped, "unpriced": unpriced}


def _atomic_write(path: Path, text: str) -> None:
    """Write via a temp file + ``os.replace`` (atomic on POSIX)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = (path.stat().st_mode & 0o777) if path.exists() else 0o644
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name,
                               suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp, mode)       # mkstemp creates 0600; keep the old mode
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def write_journal(date: str, rows: list[dict],
                  replace: set | list | tuple | bool | None = None) -> Path:
    """Write the day's trades to a JSONL audit log.

    Default (``replace is None``): **append**, de-duplicated by trade id — a
    one-shot replay can never double-book.

    ``replace`` given: the day's file is rewritten as a **coherent snapshot**.
    With a set/list of strategy names only those books are replaced (a manual
    ledger row is preserved); ``True`` replaces the whole day. Replaying the
    tape twice must never leave two alternative histories in one file.
    """
    JOURNAL_DIR.mkdir(parents=True, exist_ok=True)
    path = JOURNAL_DIR / f"{date}.jsonl"
    existing = read_journal(date)

    if replace is not None:
        scope = None if replace is True else {
            str(s) for s in (replace or ())}
        kept = [r for r in existing
                if scope is not None and str(r.get("strategy") or "") not in scope]
        # Preserve order: kept books first (in their old order), then this
        # pass's rows in the order it produced them.
        keyed: dict[str, dict] = {}
        for r in kept:
            keyed.setdefault(_trade_id(r), r)
        for r in rows:
            rec = dict(r)
            keyed[_trade_id(rec)] = rec
        now = datetime.now().isoformat()
        lines = []
        for rec in keyed.values():
            rec["_key"] = _trade_id(rec)
            rec["_logged_at"] = rec.get("_logged_at") or now
            lines.append(json.dumps(rec))
        _atomic_write(path, "\n".join(lines) + ("\n" if lines else ""))
        return path

    seen = set()
    if path.exists():
        for line in path.read_text().splitlines():
            try:
                k = json.loads(line).get("_key")
                if k:
                    seen.add(k)
            except json.JSONDecodeError:
                continue
    with path.open("a") as fh:
        for r in rows:
            key = _trade_id(r)
            if key in seen:
                continue
            rec = dict(r)
            rec["_key"] = key
            rec["_logged_at"] = datetime.now().isoformat()
            fh.write(json.dumps(rec) + "\n")
            seen.add(key)
    return path


def read_journal(date: str) -> list[dict]:
    path = JOURNAL_DIR / f"{date}.jsonl"
    if not path.exists():
        return []
    out = []
    for line in path.read_text().splitlines():
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def _book_stats(rows) -> dict:
    """n / wins / net for one book (manual or coded)."""
    rows = list(rows or [])
    net = sum(float(t.net_pnl or 0) for t in rows)
    return {
        "n": len(rows),
        "net": round(net, 2),
        "wins": sum(1 for t in rows if float(t.net_pnl or 0) > 0),
    }


def _source_tag(row) -> str:
    """The originating strategy carried in ``reason`` as ``[<strategy>] ...``."""
    reason = str(getattr(row, "reason", "") or "")
    if reason.startswith("[") and "]" in reason:
        return reason[1:reason.index("]")]
    return ""


def account_snapshot(email: str = EMAIL) -> dict:
    """Capital + realized P&L for the options paper account (read-only).

    The account spans **two** rows of the book: the per-strategy coded bots
    (``source='options_paper'``, owned by the paper user) and the agent book
    (``source='options_paper_agent'``, owned by :data:`AGENT_OWNER_EMAIL`).
    Filtering on ``source == 'options_paper'`` alone showed ₹0 while the agent
    book held the P&L, so the query is ``source LIKE 'options_paper%'`` over
    both owners (the owner falls back to ``email``).

    The result splits ``manual`` (agent discretionary trades, tagged
    ``[agent_discretionary]``) from ``coded`` (everything else), matching the
    EOD report's two books.

    Never raises: if neither account has been created yet it returns a zeroed
    snapshot with ``exists: False`` so the EOD note can still render.
    """
    from db.models import Trade as TradeModel, User
    db = _session()
    try:
        primary = db.query(User).filter(User.email == email).first()
        try:
            owner = db.query(User).filter(
                User.email == AGENT_OWNER_EMAIL).first()
        except Exception:  # pragma: no cover - defensive
            owner = None
        users = {u.id: u for u in (primary, owner) if u is not None}
        if not users:
            return {
                "email": email, "exists": False, "initial_capital": 0.0,
                "realized_pnl": 0.0, "equity": 0.0, "trades": 0,
                "by_strategy": {}, "by_book": {"manual": _book_stats([]),
                                               "coded": _book_stats([])},
            }
        rows = db.query(TradeModel).filter(
            TradeModel.user_id.in_(list(users)),
            TradeModel.source.like("options_paper%"),
        ).all()
        realized = sum(float(t.net_pnl or 0) for t in rows)

        manual, coded = [], []
        by_strategy: dict[str, dict] = {}
        for t in rows:
            tag = _source_tag(t)
            is_manual = (str(getattr(t, "source", "")) == "options_paper_agent"
                         and tag == "agent_discretionary")
            (manual if is_manual else coded).append(t)
            # Attribution: the originating strategy for agent rows, the
            # per-strategy bot's name (without the OPTPAPER prefix) otherwise.
            key = (tag or str(getattr(t, "strategy_name", "") or "unknown"))
            key = key.removeprefix("OPTPAPER ")
            s = by_strategy.setdefault(key, {"n": 0, "net": 0.0, "wins": 0})
            s["n"] += 1
            s["net"] += float(t.net_pnl or 0)
            if float(t.net_pnl or 0) > 0:
                s["wins"] += 1
        base = primary or owner
        capital = float(getattr(base, "initial_capital", 0) or 0)
        return {
            "email": email, "exists": True,
            "owner_email": getattr(owner or primary, "email", email),
            "accounts": sorted(u.email for u in users.values()),
            "initial_capital": capital,
            "realized_pnl": round(realized, 2),
            "equity": round(capital + realized, 2),
            "trades": len(rows), "by_strategy": by_strategy,
            "by_book": {
                "manual": _book_stats(manual),
                "coded": _book_stats(coded),
            },
        }
    finally:
        db.close()

#!/usr/bin/env python3
"""
News Analysis Queue — enqueue, process, and track progress.

Usage:
  python scripts/news_analysis_queue.py enqueue [--limit N] [--force]
  python scripts/news_analysis_queue.py process [--max N]
  python scripts/news_analysis_queue.py status
  python scripts/news_analysis_queue.py reset
"""

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from db.database import SessionLocal, engine
from llm_analyzer import article_analyzer

HEADER = f"{'ID':>4} | {'Status':>10} | {'Sentiment':>9} | {'Impact':>6} | {'Headline'}"
SEP = "-" * len(HEADER)


def _ensure_table():
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS news_analysis_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                article_id INTEGER NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                attempt INTEGER DEFAULT 0,
                error TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (article_id) REFERENCES news_articles(id)
            )
        """))


def cmd_enqueue(args):
    _ensure_table()
    db = SessionLocal()
    try:
        from db.models.news import NewsArticle
        from sqlalchemy import func, and_

        # articles that need analysis
        query = db.query(NewsArticle).filter(
            NewsArticle.content.isnot(None),
            NewsArticle.content != "",
        )

        if args.force:
            query = query.filter(
                (NewsArticle.analysis_json.is_(None))
                | (NewsArticle.sentiment.is_(None))
                | (NewsArticle.impact_score.is_(None))
                | (NewsArticle.analysis_json.like('%summaries%'))
                | (NewsArticle.analysis_json.like('%Summary unavailable.%'))
            )
        else:
            query = query.filter(NewsArticle.analysis_json.is_(None))

        query = query.order_by(NewsArticle.fetched_at.asc())
        if args.limit:
            query = query.limit(args.limit)

        articles = query.all()

        if not articles:
            print("No articles to enqueue.")
            return

        # add to queue (skip duplicates already in queue)
        existing = {
            r[0] for r in db.execute(
                text("SELECT article_id FROM news_analysis_queue WHERE status != 'done'")
            ).fetchall()
        }

        new_count = 0
        for a in articles:
            if a.id not in existing:
                db.execute(
                    text("INSERT INTO news_analysis_queue (article_id, status) VALUES (:aid, 'pending')"),
                    {"aid": a.id}
                )
                new_count += 1

        db.commit()
        print(f"Enqueued {new_count} articles (skipped {len(articles) - new_count} already queued)")
    finally:
        db.close()


def cmd_process(args):
    _ensure_table()
    db = SessionLocal()
    try:
        # fetch pending items
        rows = db.execute(
            text("""
                SELECT q.id, q.article_id, a.headline, a.url, a.content
                FROM news_analysis_queue q
                JOIN news_articles a ON a.id = q.article_id
                WHERE q.status = 'pending'
                ORDER BY q.id ASC
                LIMIT :lim
            """),
            {"lim": args.max or 999999}
        ).fetchall()

        if not rows:
            # show status instead
            _show_status(db)
            return

        total = len(rows)
        print(f"\nQueue: {total} articles to process\n")
        print(HEADER)
        print(SEP)

        for i, (qid, aid, headline, url, content) in enumerate(rows, 1):
            headline = headline or ""

            # mark processing
            db.execute(
                text("UPDATE news_analysis_queue SET status='processing', updated_at=CURRENT_TIMESTAMP WHERE id=:qid"),
                {"qid": qid}
            )
            db.commit()

            hdr = headline[:55] + ".." if len(headline) > 55 else headline
            result = None
            try:
                result = article_analyzer.analyze_article(url or "", headline, content or "")
            except Exception as e:
                err = str(e)[:80]
                db.execute(
                    text("UPDATE news_analysis_queue SET status='failed', error=:err, attempt=attempt+1, updated_at=CURRENT_TIMESTAMP WHERE id=:qid"),
                    {"qid": qid, "err": err}
                )
                db.commit()
                print(f"{i:>4} | {' FAILED':>10} | {'':>9} | {'':>6} | {hdr}")
                print(f"           error: {err}")
                continue

            summary = result.get("summary", "")
            if not summary or summary == "Summary unavailable." or "Failed to analyze" in summary:
                db.execute(
                    text("UPDATE news_analysis_queue SET status='failed', error=:err, attempt=attempt+1, updated_at=CURRENT_TIMESTAMP WHERE id=:qid"),
                    {"qid": qid, "err": summary[:200]}
                )
                db.commit()
                print(f"{i:>4} | {'FAILED':>10} | {'':>9} | {'':>6} | {hdr}")
                print(f"           {summary[:80]}")
                continue

            # success — update article + queue
            sentiment = result.get("sentiment", "NEUTRAL").upper()
            impact = int(result.get("impact_score", 0))
            db.execute(
                text("""
                    UPDATE news_articles
                    SET analysis_json=:aj, sentiment=:s, impact_score=:imp
                    WHERE id=:aid
                """),
                {"aj": json.dumps(result), "s": sentiment, "imp": impact, "aid": aid}
            )
            db.execute(
                text("UPDATE news_analysis_queue SET status='done', attempt=attempt+1, updated_at=CURRENT_TIMESTAMP WHERE id=:qid"),
                {"qid": qid}
            )
            db.commit()

            print(f"{i:>4} | {'done':>10} | {sentiment:>9} | {impact:>6} | {hdr}")

        # final status
        print(f"\nDone processing {total} articles\n")
        _show_status(db)

    finally:
        db.close()


def cmd_status(args=None):
    _ensure_table()
    db = SessionLocal()
    try:
        _show_status(db)
    finally:
        db.close()


def cmd_reset(args=None):
    _ensure_table()
    db = SessionLocal()
    try:
        db.execute(text("DELETE FROM news_analysis_queue"))
        db.commit()
        print("Queue cleared")
    finally:
        db.close()


def _show_status(db):
    rows = db.execute(text("""
        SELECT status, COUNT(*) as cnt FROM news_analysis_queue GROUP BY status
    """)).fetchall()

    if not rows:
        print("Queue is empty")
        return

    total = sum(r[1] for r in rows)
    print(f"{'Status':>12} | Count")
    print("-" * 25)
    for status, cnt in sorted(rows, key=lambda x: x[0]):
        print(f"{status:>12} | {cnt}")
    print("-" * 25)
    print(f"{'TOTAL':>12} | {total}")

    # show last 5 failed
    failed = db.execute(text("""
        SELECT q.id, q.article_id, a.headline, q.error
        FROM news_analysis_queue q
        JOIN news_articles a ON a.id = q.article_id
        WHERE q.status = 'failed'
        ORDER BY q.updated_at DESC
        LIMIT 5
    """)).fetchall()
    if failed:
        print("\nRecent failures:")
        for qid, aid, h, e in failed:
            hl = (h or "")[:50]
            print(f"  qid={qid} article={aid}: {hl} — {e or 'unknown'}")

    # show pending
    pending = db.execute(text("""
        SELECT COUNT(*) FROM news_analysis_queue WHERE status = 'pending'
    """)).scalar()
    if pending:
        print(f"\n{pending} pending — run `python scripts/news_analysis_queue.py process`")


def main():
    parser = argparse.ArgumentParser(description="News Analysis Queue")
    sub = parser.add_subparsers(dest="command")

    p_enq = sub.add_parser("enqueue", help="Add articles to the queue")
    p_enq.add_argument("--limit", type=int, default=None)
    p_enq.add_argument("--force", action="store_true")

    p_proc = sub.add_parser("process", help="Process queued articles")
    p_proc.add_argument("--max", type=int, default=None)

    sub.add_parser("status", help="Show queue status")
    sub.add_parser("reset", help="Clear the queue")

    args = parser.parse_args()
    if args.command == "enqueue":
        cmd_enqueue(args)
    elif args.command == "process":
        cmd_process(args)
    elif args.command == "status":
        cmd_status()
    elif args.command == "reset":
        cmd_reset()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()

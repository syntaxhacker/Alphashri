"""
Backfill LLM analysis for news articles missing analysis_json.

Processes articles one-by-one with a queue, shows progress.
Usage: python scripts/backfill_news_analysis.py [--limit N] [--force]
"""

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from db.database import SessionLocal
from db.models.news import NewsArticle
from sqlalchemy import func
from llm_analyzer import article_analyzer


def get_queue(force: bool = False, limit: int | None = None):
    db = SessionLocal()
    try:
        query = db.query(NewsArticle).filter(
            NewsArticle.content.isnot(None),
            NewsArticle.content != "",
        )
        if force:
            query = query.filter(
                (NewsArticle.analysis_json.is_(None))
                | (NewsArticle.sentiment.is_(None))
                | (NewsArticle.impact_score.is_(None))
            )
        else:
            query = query.filter(NewsArticle.analysis_json.is_(None))

        query = query.order_by(NewsArticle.fetched_at.asc())

        if limit:
            query = query.limit(limit)

        return query.all()
    finally:
        db.close()


def process_article(article: NewsArticle) -> bool:
    url = article.url or ""
    headline = article.headline or ""
    content = article.content or ""

    if not content.strip():
        print(f"  ⏭️  SKIP (empty content): id={article.id}")
        return False

    print(f"  🔄 Analyzing: {headline[:60]}...")
    try:
        result = article_analyzer.analyze_article(url, headline, content)
    except Exception as e:
        print(f"  ❌ FAIL: {e}")
        return False

    if "Failed to analyze" in result.get("summary", ""):
        print(f"  ⚠️  Analysis returned error: {result['summary']}")
        return False

    db = SessionLocal()
    try:
        existing = db.query(NewsArticle).filter(NewsArticle.id == article.id).first()
        if existing:
            existing.analysis_json = json.dumps(result)
            existing.sentiment = result.get("sentiment", "NEUTRAL").upper()
            existing.impact_score = int(result.get("impact_score", 0))
            db.commit()
            print(f"  ✅ Saved: {result.get('sentiment')} | Impact: {result.get('impact_score')} | Summary: {result.get('summary', '')[:50]}...")
            return True
        else:
            print(f"  ⚠️  Article {article.id} not found in DB anymore")
            return False
    except Exception as e:
        db.rollback()
        print(f"  ❌ DB error: {e}")
        return False
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="Backfill LLM analysis for news articles")
    parser.add_argument("--limit", type=int, default=None, help="Max articles to process")
    parser.add_argument("--force", action="store_true", help="Re-analyze even if already has analysis")
    args = parser.parse_args()

    queue = get_queue(force=args.force, limit=args.limit)

    if not queue:
        print("✅ No articles need analysis.")
        return

    total = len(queue)
    print(f"\n📰 Queue: {total} articles to process\n")

    success = 0
    failed = 0
    skipped = 0

    for i, article in enumerate(queue, 1):
        print(f"[{i}/{total}] ", end="")
        try:
            if process_article(article):
                success += 1
            else:
                failed += 1
        except KeyboardInterrupt:
            print("\n\n⏹️  Interrupted by user")
            break

        if i < total:
            # Small delay between articles to avoid rate limits
            time.sleep(1)

    print(f"\n{'='*40}")
    print(f"Done: {success} analyzed, {failed} failed, {skipped} empty")
    print(f"{'='*40}")


if __name__ == "__main__":
    main()

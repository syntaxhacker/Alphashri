#!/usr/bin/env python3
"""
News API module for fetching financial news from multiple sources.
Currently supports Moneycontrol.
"""

import re
import hashlib
from datetime import datetime
from typing import List, Dict, Optional, Tuple
from scrapling.fetchers import Fetcher


def _generate_id(url: str) -> str:
    """Generate a unique ID from URL."""
    return hashlib.md5(url.encode()).hexdigest()[:12]


def _extract_article_id(url: str) -> Optional[str]:
    """Extract article ID from moneycontrol URL."""
    match = re.search(r'-(\d+)\.html', url)
    if match:
        return match.group(1)
    return None


def _is_news_article(url: str) -> bool:
    """Check if URL is a news article (has .html and article ID pattern)."""
    if not url or '.html' not in url:
        return False
    return bool(re.search(r'-\d+\.html', url))


def _parse_date(date_str: str) -> Optional[datetime]:
    """Parse various date formats from Moneycontrol."""
    if not date_str:
        return None

    # Clean up the string
    date_str = date_str.strip()

    # Remove "first published:" prefix if present
    date_str = re.sub(r'^first published:\s*', '', date_str, flags=re.IGNORECASE)

    # Try various formats
    formats = [
        '%B %d, %Y %H:%M',         # February 26, 2026 22:06
        '%b %d, %Y %H:%M',         # Feb 26, 2026 22:06
        '%b %d, %Y %I:%M %p',      # Feb 26, 2026 10:06 pm
        '%B %d, %Y %I:%M %p',      # February 26, 2026 10:06 pm
        '%b %d, %Y',               # Feb 26, 2026
        '%B %d, %Y',               # February 26, 2026
        '%d %b %Y',                # 26 Feb 2026
        '%d %B %Y',                # 26 February 2026
        '%Y-%m-%d %H:%M:%S',       # 2026-02-26 10:06:00
        '%Y-%m-%dT%H:%M:%S',       # 2026-02-26T10:06:00
        '%Y-%m-%d',                # 2026-02-26
    ]

    for fmt in formats:
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue

    return None


def _extract_publish_date(page) -> Optional[str]:
    """Extract publish date from Moneycontrol article page."""
    # Method 1: Look for .article_schedule class (Moneycontrol specific)
    schedule_el = page.css('.article_schedule')
    if schedule_el:
        # Get all text within the element
        text_parts = schedule_el[0].css('::text').getall()
        full_text = ' '.join(t.strip() for t in text_parts if t.strip())
        # Parse date like "February 26, 2026 / 22:06 IST"
        match = re.search(r'([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})(?:\s*/\s*(\d{1,2}:\d{2}))?', full_text)
        if match:
            date_str = match.group(1)
            time_str = match.group(2)
            if time_str:
                # Combine date and time
                full_date = f"{date_str} {time_str}"
                parsed = _parse_date(full_date)
            else:
                parsed = _parse_date(date_str)
            if parsed:
                return parsed.isoformat()

    # Method 2: Look for date text in spans/divs
    all_text_elements = page.css('span::text').getall() + page.css('div::text').getall()

    date_patterns = [
        r'first published:\s*([A-Z][a-z]+\s+\d{1,2},?\s+\d{4}(?:\s+\d{1,2}:\d{2}\s*[ap]m)?)',
        r'([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})',
        r'(\d{1,2}\s+[A-Z][a-z]+\s+\d{4})',
    ]

    for text in all_text_elements:
        text = text.strip()
        if len(text) < 100:  # Short text more likely to be date
            for pattern in date_patterns:
                match = re.search(pattern, text, re.IGNORECASE)
                if match:
                    date_str = match.group(1)
                    parsed = _parse_date(date_str)
                    if parsed:
                        return parsed.isoformat()

    return None


def _extract_stock_symbols(page) -> List[Dict]:
    """Extract stock symbols mentioned in the article."""
    symbols = []

    # Get the article content area
    content_areas = page.css('.arti-flow')
    if not content_areas:
        content_areas = page.css('.article_content')

    if content_areas:
        # Get all links within the article
        article_links = content_areas[0].css('a')
        for link in article_links:
            href = link.css('::attr(href)').get() or ''
            text = link.css('::text').get() or ''

            # Stock links typically go to /india/stockpricequote/
            if '/india/stockpricequote/' in href:
                # Extract symbol from URL (last part before query)
                url_parts = href.rstrip('/').split('/')
                symbol_code = url_parts[-1] if url_parts else ''

                symbols.append({
                    'name': text.strip(),
                    'code': symbol_code,
                    'url': href if href.startswith('http') else f"https://www.moneycontrol.com{href}"
                })

    return symbols


def _extract_article_content(page) -> Tuple[str, List[Dict]]:
    """Extract article content and stock symbols."""
    article_text = ''
    symbols = []

    # Try Moneycontrol's article content selector
    content_selectors = [
        '.arti-flow',       # Moneycontrol main content
        '.article_content',
        '.article-body',
        '.content',
        'article',
    ]

    for selector in content_selectors:
        content = page.css(selector)
        if content:
            # Extract stock symbols first
            symbols = _extract_stock_symbols(page)

            # Get all text including linked stock names
            paragraphs = content[0].css('p')
            para_texts = []
            for p in paragraphs:
                # Get all text including links within the paragraph
                text_parts = p.css('::text').getall()
                link_texts = p.css('a::text').getall()
                # Combine text
                full_text = ' '.join(t.strip() for t in text_parts if t.strip())
                if full_text:
                    para_texts.append(full_text)

            if para_texts:
                article_text = '\n\n'.join(para_texts)
                break

    # Fallback: get all paragraphs
    if not article_text:
        all_paragraphs = page.css('p::text').getall()
        article_paragraphs = [p.strip() for p in all_paragraphs if len(p.strip()) > 50]
        if article_paragraphs:
            article_text = '\n\n'.join(article_paragraphs[:10])

    return article_text, symbols


def fetch_moneycontrol_news(limit: int = 25) -> List[Dict]:
    """
    Fetch latest news from Moneycontrol.

    Returns list of news items with:
    - id: unique identifier
    - headline: article title
    - description: preview text (first 150 chars of article)
    - source: "moneycontrol"
    - sourceUrl: original article URL
    - publishedAt: timestamp (if available)
    - fetchedAt: when we scraped it
    """
    print(f"Fetching news from Moneycontrol...")

    try:
        page = Fetcher.get('https://www.moneycontrol.com/news/', impersonate='chrome')
    except Exception as e:
        print(f"Error fetching Moneycontrol news: {e}")
        return []

    news_items = []
    seen_urls = set()

    # Get all links
    all_links = page.css('a')

    for link in all_links:
        href = link.css('::attr(href)').get()
        text = link.css('::text').get()

        if not href or not text:
            continue

        href_str = str(href).strip()
        text_str = str(text).strip()

        # Filter for actual news articles
        if not _is_news_article(href_str):
            continue

        # Skip short headlines (likely navigation)
        if len(text_str) < 25:
            continue

        # Skip duplicates
        if href_str in seen_urls:
            continue

        seen_urls.add(href_str)

        # Create news item
        news_item = {
            'id': _generate_id(href_str),
            'headline': text_str,
            'description': '',  # Will be filled when article is opened
            'source': 'moneycontrol',
            'sourceUrl': href_str if href_str.startswith('http') else f"https://www.moneycontrol.com{href_str}",
            'publishedAt': datetime.now().isoformat(),
            'fetchedAt': datetime.now().isoformat(),
        }

        news_items.append(news_item)

        if len(news_items) >= limit:
            break

    print(f"Fetched {len(news_items)} news items from Moneycontrol")
    return news_items


def fetch_article_content(url: str) -> Dict:
    """
    Fetch full article content from a URL.

    Returns:
    - headline: article title
    - description: full article text
    - source: source name
    - sourceUrl: original URL
    - publishedAt: timestamp (if available)
    - symbols: list of stock symbols mentioned
    """
    print(f"Fetching article: {url}")

    try:
        page = Fetcher.get(url, impersonate='chrome')
    except Exception as e:
        print(f"Error fetching article: {e}")
        return {
            'error': str(e),
            'sourceUrl': url
        }

    # Get title
    title = page.css('h1::text').get() or ''

    # Extract publish date
    published_at = _extract_publish_date(page)

    # Extract article content and stock symbols
    article_text, symbols = _extract_article_content(page)

    # Determine source from URL
    source = 'unknown'
    if 'moneycontrol.com' in url:
        source = 'moneycontrol'

    return {
        'id': _generate_id(url),
        'headline': title.strip(),
        'description': article_text,
        'source': source,
        'sourceUrl': url,
        'publishedAt': published_at or datetime.now().isoformat(),
        'fetchedAt': datetime.now().isoformat(),
        'symbols': symbols,
    }


def fetch_news(source: str = 'moneycontrol', limit: int = 25) -> List[Dict]:
    """
    Fetch news from specified source.

    Args:
        source: News source identifier (e.g., 'moneycontrol')
        limit: Maximum number of items to return

    Returns:
        List of news items
    """
    if source == 'moneycontrol':
        return fetch_moneycontrol_news(limit=limit)
    else:
        print(f"Unknown news source: {source}")
        return []


# Available news sources
NEWS_SOURCES = [
    {
        'id': 'moneycontrol',
        'name': 'Moneycontrol',
        'url': 'https://www.moneycontrol.com/news/',
    },
    # Add more sources here in the future
]

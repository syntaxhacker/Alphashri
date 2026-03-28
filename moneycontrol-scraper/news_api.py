#!/usr/bin/env python3
"""
News API module for fetching financial news from multiple sources.
Uses an Aggregator to combine and standardize news formats.
"""

import re
import json
import hashlib
from datetime import datetime
from typing import List, Dict, Optional, Tuple
import concurrent.futures
from scrapling.fetchers import Fetcher

class BaseNewsScraper:
    source_id: str = "base"
    source_name: str = "Base"
    base_url: str = ""

    def _generate_id(self, url: str) -> str:
        return hashlib.md5(url.encode()).hexdigest()[:12]

    def _fetch_page(self, url: str):
        try:
            return Fetcher.get(url, impersonate='chrome')
        except Exception as e:
            print(f"Error fetching {url}: {e}")
            return None

    def _parse_date_generic(self, date_str: str) -> Optional[datetime]:
        if not date_str:
            return None
        date_str = date_str.strip()
        date_str = re.sub(r'^first published:\s*', '', date_str, flags=re.IGNORECASE)
        date_str = re.sub(r' IST$', '', date_str, flags=re.IGNORECASE).strip()
        formats = [
            '%B %d, %Y %H:%M', '%b %d, %Y %H:%M', '%b %d, %Y %I:%M %p',
            '%B %d, %Y %I:%M %p', '%b %d, %Y', '%B %d, %Y',
            '%d %b %Y', '%d %B %Y', '%Y-%m-%d %H:%M:%S',
            '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d',
            '%d %b %Y, %I:%M %p', '%d %b %Y, %H:%M',
        ]
        for fmt in formats:
            try:
                return datetime.strptime(date_str, fmt)
            except ValueError:
                continue
        return None

    def _extract_from_meta(self, page) -> Tuple[str, str]:
        if not page:
            return "", ""
        title = ""
        description = ""
        for meta in page.css('meta'):
            attrs = meta.attrib if hasattr(meta, 'attrib') else {}
            prop = attrs.get('property', '') or attrs.get('name', '')
            content = attrs.get('content', '')
            if not content:
                continue
            if prop.lower() == 'og:title' and not title:
                title = content.strip()
            elif prop.lower() == 'og:description' and not description:
                description = content.strip()
            elif prop.lower() == 'description' and not description:
                description = content.strip()
        return title, description

    def _generic_article_extraction(self, page) -> Tuple[str, str, Optional[str], List[Dict]]:
        if not page:
            return "", "", None, []
        
        title = (page.css('h1::text').get() or '').strip() or (page.css('h2.title::text').get() or '').strip() or ""
        article_text = ""
        paragraphs = page.css('article p::text').getall() or page.css('.story p::text').getall() or page.css('div p::text').getall()
        article_paragraphs = [p.strip() for p in paragraphs if len(p.strip()) > 50]
        if article_paragraphs:
            article_text = '\n\n'.join(article_paragraphs[:10])

        published_at = None
        date_elements = page.css('time::text').getall() + page.css('.date::text').getall() + page.css('.time::text').getall()
        for d in date_elements:
            parsed = self._parse_date_generic(d)
            if parsed:
                published_at = parsed.isoformat()
                break

        if not title or not article_text:
            ld_data = self._extract_ld_json(page)
            if not title:
                for item in ld_data:
                    t = item.get('headline') or item.get('name')
                    if t:
                        title = t
                        break
            if not article_text:
                for item in ld_data:
                    desc = item.get('description') or item.get('articleBody') or item.get('text')
                    if desc and len(desc) > 50:
                        article_text = desc.strip()
                        break
                if not article_text:
                    for item in ld_data:
                        desc = item.get('description') or ''
                        if desc:
                            article_text = desc.strip()
                            break

        if not title or not article_text:
            meta_title, meta_desc = self._extract_from_meta(page)
            if not title:
                title = meta_title
            if not article_text:
                article_text = meta_desc

        return title.strip(), article_text, published_at, []

    def fetch_latest_news(self, limit: int = 25) -> List[Dict]:
        page = self._fetch_page(self.base_url)
        if not page:
            return []
            
        news_items = []
        seen_urls = set()
        
        links = page.css('a')
        for link in links:
            href = link.css('::attr(href)').get()
            text = link.css('::text').get()
            
            if not href or not text:
                continue
                
            href_str = str(href).strip()
            text_str = str(text).strip()
            
            if not self._is_news_article(href_str):
                continue
                
            if len(text_str) < 25:
                continue
                
            # Normalize URL
            if not href_str.startswith('http'):
                if href_str.startswith('/'):
                    domain = '/'.join(self.base_url.split('/')[:3])
                    href_str = f"{domain}{href_str}"
                else:
                    continue

            if href_str in seen_urls:
                continue
            seen_urls.add(href_str)
            
            news_items.append({
                'id': self._generate_id(href_str),
                'headline': text_str.strip(),
                'description': '',
                'source': self.source_id,
                'sourceUrl': href_str,
                'publishedAt': datetime.now().isoformat(),
                'fetchedAt': datetime.now().isoformat(),
            })
            if len(news_items) >= limit:
                break
                
        return news_items

    def fetch_article_content(self, url: str) -> Dict:
        page = self._fetch_page(url)
        if not page:
             return {
                'id': self._generate_id(url),
                'error': 'Failed to fetch article',
                'headline': '',
                'description': '',
                'source': self.source_id,
                'sourceUrl': url,
                'publishedAt': datetime.now().isoformat(),
                'fetchedAt': datetime.now().isoformat(),
                'symbols': [],
            }

        title, article_text, published_at, symbols = self._extract_specifics(page, url)
        if not title:
            # Fallback
            title, text_fb, date_fb, sym_fb = self._generic_article_extraction(page)
            if not article_text: article_text = text_fb
            if not published_at: published_at = date_fb
            if not symbols: symbols = sym_fb
            
        return {
            'id': self._generate_id(url),
            'headline': title,
            'description': article_text,
            'source': self.source_id,
            'sourceUrl': url,
            'publishedAt': published_at or datetime.now().isoformat(),
            'fetchedAt': datetime.now().isoformat(),
            'symbols': symbols,
        }

    def _extract_ld_json(self, page) -> List[Dict]:
        results = []
        for script in page.css('script[type="application/ld+json"]'):
            text = ' '.join(script.css('::text').getall()).strip()
            if not text:
                continue
            text = re.sub(r'[\x00-\x1f]', ' ', text)
            try:
                data = json.loads(text)
                if isinstance(data, list):
                    results.extend(data)
                elif isinstance(data, dict):
                    results.append(data)
            except json.JSONDecodeError:
                pass
        return results

    def _is_news_article(self, url: str) -> bool:
        """Override in subclasses to filter URLs"""
        return True

    def _extract_specifics(self, page, url: str) -> Tuple[str, str, Optional[str], List[Dict]]:
        """Override to extract title, content, date, symbols specific to the site."""
        return "", "", None, []


class MoneycontrolScraper(BaseNewsScraper):
    source_id = "moneycontrol"
    source_name = "Moneycontrol"
    base_url = "https://www.moneycontrol.com/news/"

    def _is_news_article(self, url: str) -> bool:
        if not url or '.html' not in url:
            return False
        return bool(re.search(r'-\d+\.html', url))

    def _extract_specifics(self, page, url: str) -> Tuple[str, str, Optional[str], List[Dict]]:
        title = page.css('h1::text').get() or ''

        # Publish date
        published_at = None
        schedule_el = page.css('.article_schedule')
        if schedule_el:
            text_parts = schedule_el[0].css('::text').getall()
            full_text = ' '.join(t.strip() for t in text_parts if t.strip())
            match = re.search(r'([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})(?:\s*/\s*(\d{1,2}:\d{2}))?', full_text)
            if match:
                date_str = match.group(1)
                time_str = match.group(2)
                parsed = self._parse_date_generic(f"{date_str} {time_str}" if time_str else date_str)
                if parsed:
                    published_at = parsed.isoformat()

        # Extract symbols
        symbols = []
        content_areas = page.css('.arti-flow') or page.css('.article_content')
        if content_areas:
            for link in content_areas[0].css('a'):
                href = link.css('::attr(href)').get() or ''
                text = link.css('::text').get() or ''
                if '/india/stockpricequote/' in href:
                    url_parts = href.rstrip('/').split('/')
                    symbols.append({
                        'name': text.strip(),
                        'code': url_parts[-1] if url_parts else '',
                        'url': href if href.startswith('http') else f"https://www.moneycontrol.com{href}"
                    })

        # Article content (paywalled - extract what's available)
        article_text = ''
        if content_areas:
            para_texts = [' '.join(p.css('::text').getall()).strip() for p in content_areas[0].css('p')]
            article_text = '\n\n'.join(p for p in para_texts if p)

        # Fallback: ld+json description
        if not article_text:
            for item in self._extract_ld_json(page):
                desc = item.get('description', '')
                if desc and len(desc) > 50:
                    article_text = desc
                    break

        return title.strip(), article_text, published_at, symbols


class EconomicTimesScraper(BaseNewsScraper):
    source_id = "economictimes"
    source_name = "Economic Times"
    base_url = "https://economictimes.indiatimes.com/markets/stocks/news"

    def _is_news_article(self, url: str) -> bool:
        return '/articleshow/' in url

    def _extract_specifics(self, page, url: str) -> Tuple[str, str, Optional[str], List[Dict]]:
        title = page.css('h1::text').get() or ''

        # Extract from ld+json structured data
        published_at = None
        article_text = ''
        for item in self._extract_ld_json(page):
            if item.get('@type') in ('NewsArticle', 'Article'):
                if not article_text and item.get('articleBody'):
                    article_text = item['articleBody']
                if not published_at and item.get('datePublished'):
                    date_str = re.sub(r'[+-]\d{2}:\d{2}$', '', item['datePublished'].strip())
                    parsed = self._parse_date_generic(date_str)
                    if parsed:
                        published_at = parsed.isoformat()

        # Fallback: synopsis
        if not article_text:
            syn = page.css('.artSyn')
            if syn:
                article_text = ' '.join(syn[0].css('::text').getall()).strip()

        return title.strip(), article_text, published_at, []

class LivemintScraper(BaseNewsScraper):
    source_id = "livemint"
    source_name = "Livemint"
    base_url = "https://www.livemint.com/market/stock-market-news"

    def _is_news_article(self, url: str) -> bool:
         return re.search(r'-\d+\.html$', url) is not None

    def _extract_specifics(self, page, url: str) -> Tuple[str, str, Optional[str], List[Dict]]:
        title = page.css('h1::text').get() or ''

        # Date from meta tags
        published_at = None
        for meta in page.css('meta'):
            attrs = meta.attrib if hasattr(meta, 'attrib') else {}
            prop = attrs.get('property', '')
            content = attrs.get('content', '')
            if prop == 'article:published_time' and content:
                date_str = re.sub(r'[+-]\d{2}:\d{2}$', '', content.strip())
                parsed = self._parse_date_generic(date_str)
                if parsed:
                    published_at = parsed.isoformat()
                    break

        # Article content from storyParagraph divs
        article_text = ''
        paragraphs = page.css('.storyParagraph')
        if paragraphs:
            texts = [' '.join(p.css('::text').getall()).strip() for p in paragraphs]
            article_text = '\n\n'.join(t for t in texts if t)
        else:
            # Fallback: storyContent
            story = page.css('.storyContent')
            if story:
                article_text = ' '.join(story[0].css('::text').getall()).strip()

        return title.strip(), article_text, published_at, []

class FinancialExpressScraper(BaseNewsScraper):
    source_id = "financialexpress"
    source_name = "Financial Express"
    base_url = "https://www.financialexpress.com/market/"

    def _is_news_article(self, url: str) -> bool:
        return bool(re.search(r'/\d+/$', url)) or '/article/' in url
    
    def _extract_specifics(self, page, url: str) -> Tuple[str, str, Optional[str], List[Dict]]:
        title = page.css('h1::text').get() or ''

        # Date from ld+json or visible element
        published_at = None
        for item in self._extract_ld_json(page):
            if item.get('datePublished'):
                date_str = re.sub(r'[+-]\d{2}:\d{2}$', '', item['datePublished'].strip())
                parsed = self._parse_date_generic(date_str)
                if parsed:
                    published_at = parsed.isoformat()
                    break
        if not published_at:
            date_el = page.css('.post-date::text').get() or page.css('.date::text').get()
            if date_el:
                parsed = self._parse_date_generic(date_el.strip())
                if parsed:
                    published_at = parsed.isoformat()
        
        symbols = []
        article_text = ''
        
        content_areas = page.css('.article-body') or page.css('.post-content') or page.css('article')
        if content_areas:
            for link in content_areas[0].css('a'):
                href = link.css('::attr(href)').get() or ''
                text = link.css('::text').get() or ''
                
                if '/company/' in href or '/stocks/' in href:
                    text_clean = text.strip()
                    if text_clean and len(text_clean) >= 3 and len(text_clean) <= 50:
                        if not re.match(r'^[A-Z]{2,}$', text_clean):
                            symbols.append({
                                'name': text_clean,
                                'code': text_clean.upper().replace(' ', ''),
                                'url': href if href.startswith('http') else f"https://www.financialexpress.com{href}"
                            })
            
            para_texts = [' '.join(p.css('::text').getall()).strip() for p in content_areas[0].css('p')]
            article_text = '\n\n'.join(p for p in para_texts if p)
        
        return title.strip(), article_text, published_at, symbols

class BusinessStandardScraper(BaseNewsScraper):
    source_id = "business_standard"
    source_name = "Business Standard"
    base_url = "https://www.business-standard.com/markets/stock-market"

    def _is_news_article(self, url: str) -> bool:
        return bool(re.search(r'_\d+\.html$', url))

    def _extract_specifics(self, page, url: str) -> Tuple[str, str, Optional[str], List[Dict]]:
        title = page.css('h1::text').get() or ''

        # Date from meta tags
        published_at = None
        for meta in page.css('meta'):
            attrs = meta.attrib if hasattr(meta, 'attrib') else {}
            prop = attrs.get('property', '')
            content = attrs.get('content', '')
            if prop == 'article:published_time' and content:
                date_str = re.sub(r'[+-]\d{2}:\d{2}$', '', content.strip())
                parsed = self._parse_date_generic(date_str)
                if parsed:
                    published_at = parsed.isoformat()
                    break

        # Article content from .content-items divs (live blog format)
        article_text = ''
        items = page.css('.content-items')
        if items:
            texts = [' '.join(item.css('::text').getall()).strip() for item in items]
            article_text = '\n\n'.join(t for t in texts if t)

        # Fallback: .storycontent div (standard articles)
        if not article_text:
            story = page.css('.storycontent')
            if story:
                article_text = ' '.join(story[0].css('::text').getall()).strip()

        # Fallback: ld+json
        if not article_text:
            for item in self._extract_ld_json(page):
                body = item.get('articleBody', '')
                if body and len(body) > 50:
                    article_text = body
                    break

        return title.strip(), article_text, published_at, []

class CNBCTV18Scraper(BaseNewsScraper):
    source_id = "cnbctv18"
    source_name = "CNBC TV18"
    base_url = "https://www.cnbctv18.com/market/"

    def _is_news_article(self, url: str) -> bool:
        return bool(re.search(r'-\d+\.htm$', url))

    def _extract_specifics(self, page, url: str) -> Tuple[str, str, Optional[str], List[Dict]]:
        title = page.css('h1::text').get() or ''

        # Date from meta tags
        published_at = None
        for meta in page.css('meta'):
            attrs = meta.attrib if hasattr(meta, 'attrib') else {}
            prop = attrs.get('property', '')
            content = attrs.get('content', '')
            if prop == 'article:published_time' and content:
                # Strip timezone offset for parsing
                date_str = re.sub(r'[+-]\d{2}:\d{2}$', '', content.strip())
                parsed = self._parse_date_generic(date_str)
                if parsed:
                    published_at = parsed.isoformat()
                    break

        # Article content from .narticle-text div
        article_text = ''
        content_area = page.css('.narticle-text')
        if content_area:
            texts = [' '.join(p.css('::text').getall()).strip() for p in content_area[0].css('p')]
            article_text = '\n\n'.join(t for t in texts if len(t) > 20)
            if not article_text:
                # Fallback: get all text nodes directly from the div
                all_text = ' '.join(content_area[0].css('::text').getall()).strip()
                # Remove the "X Min Read" prefix
                all_text = re.sub(r'^\d+\s*Min Read\s*', '', all_text)
                if len(all_text) > 50:
                    article_text = all_text

        return title.strip(), article_text, published_at, []

# Aggregator
class NewsAggregator:
    def __init__(self):
        self.scrapers = {
            'moneycontrol': MoneycontrolScraper(),
            'economictimes': EconomicTimesScraper(),
            'livemint': LivemintScraper(),
            'financialexpress': FinancialExpressScraper(),
            'business_standard': BusinessStandardScraper(),
            'cnbctv18': CNBCTV18Scraper(),
        }

    def fetch_from_source(self, source_id: str, limit: int = 25) -> List[Dict]:
        scraper = self.scrapers.get(source_id)
        if not scraper:
            print(f"Unknown source: {source_id}")
            return []
        print(f"Fetching news from {scraper.source_name}...")
        return scraper.fetch_latest_news(limit)

    def fetch_all(self, limit_per_source: int = 10) -> List[Dict]:
        # Fixed source order for deterministic results
        source_order = [
            'moneycontrol', 'economictimes', 'livemint',
            'financialexpress', 'business_standard', 'cnbctv18'
        ]
        all_news = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(self.scrapers)) as executor:
            future_to_source = {}
            for sid in source_order:
                scraper = self.scrapers.get(sid)
                if scraper:
                    future_to_source[executor.submit(scraper.fetch_latest_news, limit_per_source)] = sid

            # Collect results as they complete, store by source
            results_by_source = {}
            for future in concurrent.futures.as_completed(future_to_source):
                source_id = future_to_source[future]
                try:
                    news = future.result()
                    results_by_source[source_id] = news
                    print(f"Finished {source_id}: {len(news)} items")
                except Exception as e:
                    print(f"Error fetching from {source_id}: {e}")
                    results_by_source[source_id] = []

        # Append in fixed source order for stable output
        for sid in source_order:
            all_news.extend(results_by_source.get(sid, []))

        return all_news

    def fetch_article(self, source_id: str, url: str) -> Dict:
        scraper = self.scrapers.get(source_id)
        if not scraper:
            # Fallback to base
            scraper = BaseNewsScraper()
        return scraper.fetch_article_content(url)

    def group_news_by_symbol(self, enriched_articles: List[Dict]) -> Dict[str, List[Dict]]:
        """Groups articles by stock code."""
        symbol_news = {}
        for article in enriched_articles:
            for symbol_obj in article.get('symbols', []):
                sym_code = symbol_obj.get('code')
                if not sym_code:
                    continue
                if sym_code not in symbol_news:
                    symbol_news[sym_code] = []
                
                # Deduplicate by id
                if not any(ex['id'] == article['id'] for ex in symbol_news[sym_code]):
                    symbol_news[sym_code].append({
                        'id': article['id'],
                        'headline': article.get('headline', ''),
                        'source': article.get('source', ''),
                        'sourceUrl': article.get('sourceUrl', ''),
                        'publishedAt': article.get('publishedAt', ''),
                    })

        # Sort each group by date desc
        for sym_code in symbol_news:
            symbol_news[sym_code].sort(key=lambda x: x.get('publishedAt', ''), reverse=True)

        return symbol_news


# Global Aggregator Instance
_aggregator = NewsAggregator()

# API Contract (Backward Compatibility)
NEWS_SOURCES = [
    {'id': s.source_id, 'name': s.source_name, 'url': s.base_url}
    for s in _aggregator.scrapers.values()
]

def fetch_news(source: str = None, limit: int = 25) -> List[Dict]:
    if source is None or source == 'all':
        # Fetch from all sources - divide limit per source
        num_sources = len(_aggregator.scrapers) if _aggregator.scrapers else 1
        limit_per_source = max(limit // num_sources, 5)  # At least 5 per source
        return _aggregator.fetch_all(limit_per_source)
    return _aggregator.fetch_from_source(source, limit)

def fetch_article_content(url: str) -> Dict:
    # Determine source from URL
    source_id = 'unknown'
    for s_id, scraper in _aggregator.scrapers.items():
        domain = scraper.base_url.split('/')[2]
        if domain in url:
            source_id = s_id
            break
    return _aggregator.fetch_article(source_id, url)

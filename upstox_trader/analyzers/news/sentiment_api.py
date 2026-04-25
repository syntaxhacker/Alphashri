#!/usr/bin/env python3
"""
Sentiment API - API client and data fetching for news sources
"""

import rookiepy
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from urllib.parse import quote_plus
import re
import logging


def get_tv_cookies(debug_mode=False, logger=None):
    """Get TradingView cookies for authenticated access"""
    try:
        cookies = rookiepy.to_cookiejar(rookiepy.chrome(['.tradingview.com']))
        if debug_mode:
            logger.info("✅ TradingView cookies loaded from Chrome")
        return cookies
    except:
        try:
            cookies = rookiepy.to_cookiejar(rookiepy.firefox(['.tradingview.com']))
            if debug_mode:
                logger.info("✅ TradingView cookies loaded from Firefox")
            return cookies
        except:
            if debug_mode:
                logger.warning("⚠️ No TradingView cookies - using delayed data")
            return None


def get_headers():
    """Get request headers with proper user agent"""
    return {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
    }


def scrape_moneycontrol_news(symbol, hours_back=24, processed_news=None, debug_mode=False, logger=None):
    """Scrape MoneyControl for stock-specific news"""
    if processed_news is None:
        processed_news = set()

    try:
        urls_to_try = [
            f"https://www.moneycontrol.com/news/tags/{symbol.lower()}.html",
            f"https://www.moneycontrol.com/india/stockpricequote/{symbol.lower()}",
            f"https://www.moneycontrol.com/news/business/earnings/{symbol.lower()}"
        ]

        headers = get_headers()
        news_items = []

        for url in urls_to_try:
            try:
                if debug_mode:
                    logger.info(f"🔍 Scraping MoneyControl: {url}")
                response = requests.get(url, headers=headers, timeout=10)

                if response.status_code != 200:
                    if debug_mode:
                        logger.warning(f"⚠️ MoneyControl returned status {response.status_code}")
                    continue

                soup = BeautifulSoup(response.content, 'html.parser')

                found_items = _parse_moneycontrol_page(soup, symbol, hours_back, processed_news)
                news_items.extend(found_items)

                if found_items:
                    break

            except Exception as e:
                if logger:
                    logger.debug(f"Error with URL {url}: {e}")
                continue

        if not news_items:
            search_items = _search_moneycontrol_news(symbol, hours_back, processed_news, debug_mode, logger)
            news_items.extend(search_items)

        if debug_mode:
            logger.info(f"📰 Found {len(news_items)} recent news items for {symbol} on MoneyControl")
        return news_items

    except Exception as e:
        if logger:
            logger.error(f"❌ Error scraping MoneyControl for {symbol}: {e}")
        return []


def _parse_moneycontrol_page(soup, symbol, hours_back, processed_news):
    """Parse MoneyControl page for news items"""
    news_items = []

    selectors = [
        'div.news_gist',
        'div.newslst',
        'h2 a', 'h3 a',
        'article', 'div[class*="news"]'
    ]

    articles = []
    for selector in selectors:
        articles = soup.select(selector)
        if articles:
            break

    for article in articles[:15]:
        try:
            if article.name == 'a':
                headline_elem = article
            else:
                headline_elem = article.find('a') or article

            headline = headline_elem.get_text(strip=True)
            if not headline or len(headline) < 10:
                continue

            if symbol.lower() not in headline.lower():
                continue

            link = headline_elem.get('href', '') if headline_elem.name == 'a' else ''
            if link and not link.startswith('http'):
                link = 'https://www.moneycontrol.com' + link

            news_id = f"mc_{hash(headline)}_{symbol}"
            if news_id in processed_news:
                continue

            news_item = {
                'source': 'MoneyControl',
                'symbol': symbol,
                'headline': headline,
                'link': link,
                'timestamp': datetime.now(),
                'content': '',
                'id': news_id
            }

            news_items.append(news_item)
            processed_news.add(news_id)

        except Exception as e:
            continue

    return news_items


def _search_moneycontrol_news(symbol, hours_back, processed_news, debug_mode=False, logger=None):
    """Search MoneyControl using their search functionality"""
    try:
        search_url = f"https://www.moneycontrol.com/news/business/stocks/{symbol}"
        headers = get_headers()

        response = requests.get(search_url, headers=headers, timeout=10)
        if response.status_code != 200:
            return []

        soup = BeautifulSoup(response.content, 'html.parser')
        return _parse_moneycontrol_page(soup, symbol, hours_back, processed_news)

    except Exception as e:
        if logger:
            logger.debug(f"Search failed: {e}")
        return []


def scrape_google_news(symbol, hours_back=24, processed_news=None, debug_mode=False, logger=None):
    """Scrape Google News for broader coverage"""
    if processed_news is None:
        processed_news = set()

    try:
        search_queries = [
            f'"{symbol}" stock share price india',
            f'"{symbol}" order win contract',
            f'"{symbol}" earnings results',
            f'{symbol} company news'
        ]

        all_news = []

        for search_query in search_queries:
            try:
                news_items = _search_google_with_query(search_query, symbol, hours_back, processed_news, debug_mode, logger)
                all_news.extend(news_items)
                if len(all_news) >= 10:
                    break
            except Exception as e:
                if logger:
                    logger.debug(f"Search query '{search_query}' failed: {e}")
                continue

        unique_news = []
        seen_headlines = set()
        for news in all_news:
            headline_key = news['headline'][:50]
            if headline_key not in seen_headlines:
                unique_news.append(news)
                seen_headlines.add(headline_key)

        if debug_mode:
            logger.info(f"📰 Found {len(unique_news)} relevant news items for {symbol} on Google News")
        return unique_news

    except Exception as e:
        if logger:
            logger.error(f"❌ Error scraping Google News for {symbol}: {e}")
        return []


def _search_google_with_query(search_query, symbol, hours_back, processed_news, debug_mode=False, logger=None):
    """Search Google News with a specific query"""
    try:
        encoded_query = quote_plus(search_query)

        url = f"https://news.google.com/search?q={encoded_query}&hl=en-IN&gl=IN&ceid=IN:en"
        headers = get_headers()

        response = requests.get(url, headers=headers, timeout=10)

        if response.status_code != 200:
            if debug_mode:
                logger.debug(f"Google News returned status {response.status_code} for query: {search_query}")
            return []

        soup = BeautifulSoup(response.content, 'html.parser')
        news_items = []

        selectors = ['article', 'div[class*="article"]', 'div[class*="story"]']
        articles = []

        for selector in selectors:
            articles = soup.select(selector)
            if articles:
                break

        for article in articles[:20]:
            try:
                headline_elem = (article.find('h3') or
                               article.find('h2') or
                               article.find('h4') or
                               article.find('a'))

                if not headline_elem:
                    continue

                headline = headline_elem.get_text(strip=True)
                if not headline or len(headline) < 10:
                    continue

                symbol_variations = [symbol.lower()]

                is_relevant = any(var in headline.lower() for var in symbol_variations)
                if not is_relevant:
                    continue

                link_elem = article.find('a')
                link = link_elem.get('href', '') if link_elem else ''

                news_id = f"gn_{hash(headline)}_{symbol}"
                if news_id in processed_news:
                    continue

                time_elem = article.find('time')
                news_time = datetime.now()

                if time_elem:
                    time_text = time_elem.get_text(strip=True)
                    news_time = parse_relative_time(time_text)

                news_item = {
                    'source': f'Google News ({search_query})',
                    'symbol': symbol,
                    'headline': headline,
                    'link': link,
                    'timestamp': news_time,
                    'content': '',
                    'id': news_id
                }

                news_items.append(news_item)
                processed_news.add(news_id)

            except Exception as e:
                if logger:
                    logger.debug(f"Error parsing article: {e}")
                continue

        return news_items

    except Exception as e:
        if logger:
            logger.debug(f"Error with Google search query '{search_query}': {e}")
        return []


def search_web_news(symbol, hours_back=24, processed_news=None, debug_mode=False, logger=None):
    """Search multiple financial news websites directly"""
    if processed_news is None:
        processed_news = set()

    try:
        news_sites = [
            'economictimes.indiatimes.com',
            'business-standard.com',
            'financialexpress.com',
            'livemint.com',
            'ndtv.com/business'
        ]

        all_news = []

        for site in news_sites:
            try:
                site_news = _search_financial_site(site, symbol, hours_back, processed_news, debug_mode, logger)
                all_news.extend(site_news)
                if len(all_news) >= 15:
                    break
            except Exception as e:
                if logger:
                    logger.debug(f"Error searching {site}: {e}")
                continue

        if debug_mode:
            logger.info(f"📰 Found {len(all_news)} news items from financial websites for {symbol}")
        return all_news

    except Exception as e:
        if logger:
            logger.error(f"❌ Error in web news search for {symbol}: {e}")
        return []


def _search_financial_site(site, symbol, hours_back, processed_news, debug_mode=False, logger=None):
    """Search a specific financial news site"""
    try:
        if 'economictimes' in site:
            search_url = f"https://economictimes.indiatimes.com/topic/{symbol}"
        elif 'business-standard' in site:
            search_url = f"https://www.business-standard.com/topic/{symbol}"
        elif 'financialexpress' in site:
            search_url = f"https://www.financialexpress.com/tag/{symbol}/"
        elif 'livemint' in site:
            search_url = f"https://www.livemint.com/topic/{symbol}"
        elif 'ndtv' in site:
            search_url = f"https://www.ndtv.com/search?searchtext={symbol}"
        else:
            return []

        headers = get_headers()
        response = requests.get(search_url, headers=headers, timeout=10)

        if response.status_code != 200:
            return []

        soup = BeautifulSoup(response.content, 'html.parser')
        news_items = []

        selectors = [
            'h1 a', 'h2 a', 'h3 a',
            '.headline a', '.title a',
            'article h2', 'article h3',
            '[class*="headline"]', '[class*="title"]'
        ]

        articles = []
        for selector in selectors:
            articles = soup.select(selector)
            if len(articles) >= 5:
                break

        for article in articles[:10]:
            try:
                if article.name == 'a':
                    headline = article.get_text(strip=True)
                    link = article.get('href', '')
                else:
                    link_elem = article.find('a')
                    if not link_elem:
                        continue
                    headline = link_elem.get_text(strip=True)
                    link = link_elem.get('href', '')

                if not headline or len(headline) < 15:
                    continue

                symbol_variations = [symbol.lower()]

                is_relevant = any(var in headline.lower() for var in symbol_variations)
                if not is_relevant:
                    continue

                if link and not link.startswith('http'):
                    if link.startswith('/'):
                        link = f"https://{site}{link}"
                    else:
                        link = f"https://{site}/{link}"

                news_item = {
                    'source': site.title(),
                    'symbol': symbol,
                    'headline': headline,
                    'link': link,
                    'timestamp': datetime.now(),
                    'content': '',
                    'id': f"web_{hash(headline)}_{symbol}"
                }

                news_items.append(news_item)

            except Exception as e:
                continue

        return news_items[:5]

    except Exception as e:
        if logger:
            logger.debug(f"Error searching {site}: {e}")
        return []


def parse_relative_time(time_text):
    """Parse relative time strings like '2 hours ago', '1 day ago'"""
    try:
        now = datetime.now()
        time_text = time_text.lower()

        if 'hour' in time_text:
            hours = int(re.search(r'(\d+)', time_text).group(1))
            return now - timedelta(hours=hours)
        elif 'minute' in time_text:
            minutes = int(re.search(r'(\d+)', time_text).group(1))
            return now - timedelta(minutes=minutes)
        elif 'day' in time_text:
            days = int(re.search(r'(\d+)', time_text).group(1))
            return now - timedelta(days=days)
        else:
            return now
    except:
        return datetime.now()

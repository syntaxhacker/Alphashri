#!/usr/bin/env python3
"""
News Sentiment Analyzer - Early Signal Detection
Beat the volume spike by catching news 10-15 minutes early
"""

import rookiepy
import requests
from bs4 import BeautifulSoup
import pandas as pd
from datetime import datetime, timedelta
import time
import logging
import re
import json
from urllib.parse import quote_plus
import sys
import os

# Already in upstox_trader folder

class NewsAnalyzer:
    """Early news detection system for trading signals"""
    
    def __init__(self):
        # Logging setup
        logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        self.logger = logging.getLogger('NewsAnalyzer')
        
        # TradingView cookies for authenticated access
        self.tv_cookies = self._get_tv_cookies()
        
        # News sources with priorities
        self.news_sources = {
            'moneycontrol': {
                'url_template': 'https://www.moneycontrol.com/news/tags/{symbol}.html',
                'priority': 1,
                'reliability': 0.8
            },
            'economictimes': {
                'url_template': 'https://economictimes.indiatimes.com/topic/{symbol}',
                'priority': 2, 
                'reliability': 0.9
            },
            'business_standard': {
                'url_template': 'https://www.business-standard.com/topic/{symbol}',
                'priority': 3,
                'reliability': 0.7
            }
        }
        
        # Cache for avoiding duplicate processing
        self.processed_news = set()
        
        # Sentiment keywords
        self.positive_keywords = [
            'win', 'won', 'award', 'contract', 'order', 'growth', 'expansion', 'profit', 
            'beat', 'strong', 'bullish', 'acquisition', 'merger', 'approval', 'launch',
            'breakthrough', 'success', 'milestone', 'boost', 'surge', 'rally', 'upgrade',
            'outperform', 'exceed', 'record', 'highest', 'best', 'positive', 'optimistic'
        ]
        
        self.negative_keywords = [
            'loss', 'decline', 'weak', 'concern', 'issue', 'delay', 'cancel', 'postpone',
            'warning', 'bearish', 'downgrade', 'sell', 'avoid', 'risk', 'threat', 'fall',
            'drop', 'crash', 'plunge', 'worst', 'negative', 'pessimistic', 'cut', 'reduce'
        ]
        
        # Financial impact keywords  
        self.high_impact_keywords = [
            'crore', 'billion', 'merger', 'acquisition', 'ipo', 'results', 'earnings',
            'government contract', 'tender', 'policy', 'regulation', 'ban', 'approval',
            'order win', 'contract win', 'project award', 'order book', 'revenue',
            'bagged', 'won', 'midc', 'zld', 'effluent', 'treatment', 'infrastructure'
        ]
        
        # EIEL-specific positive keywords
        self.eiel_positive_keywords = [
            'zld', 'zero liquid discharge', 'cetp', 'effluent treatment', 
            'midc', 'maharashtra industrial', 'order', 'project', 'contract',
            'environment', 'water treatment', 'pollution control'
        ]
        
    def _get_tv_cookies(self):
        """Get TradingView cookies for authenticated access"""
        try:
            cookies = rookiepy.to_cookiejar(rookiepy.chrome(['.tradingview.com']))
            self.logger.info("✅ TradingView cookies loaded from Chrome")
            return cookies
        except:
            try:
                cookies = rookiepy.to_cookiejar(rookiepy.firefox(['.tradingview.com']))
                self.logger.info("✅ TradingView cookies loaded from Firefox")
                return cookies
            except:
                self.logger.warning("⚠️ No TradingView cookies - using delayed data")
                return None
    
    def _get_headers(self):
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
    
    def scrape_moneycontrol_news(self, symbol, hours_back=24):
        """Scrape MoneyControl for stock-specific news"""
        try:
            # Try multiple URL patterns for better coverage
            urls_to_try = [
                f"https://www.moneycontrol.com/news/tags/{symbol.lower()}.html",
                f"https://www.moneycontrol.com/india/stockpricequote/{symbol.lower()}",
                f"https://www.moneycontrol.com/news/business/earnings/{symbol.lower()}"
            ]
            
            headers = self._get_headers()
            news_items = []
            
            for url in urls_to_try:
                try:
                    self.logger.info(f"🔍 Scraping MoneyControl: {url}")
                    response = requests.get(url, headers=headers, timeout=10)
                    
                    if response.status_code != 200:
                        self.logger.warning(f"⚠️ MoneyControl returned status {response.status_code}")
                        continue
                    
                    soup = BeautifulSoup(response.content, 'html.parser')
                    
                    # Try different parsing methods
                    found_items = self._parse_moneycontrol_page(soup, symbol, hours_back)
                    news_items.extend(found_items)
                    
                    if found_items:
                        break  # Found relevant news, no need to try other URLs
                        
                except Exception as e:
                    self.logger.debug(f"Error with URL {url}: {e}")
                    continue
            
            # Also try direct search
            if not news_items:
                search_items = self._search_moneycontrol_news(symbol, hours_back)
                news_items.extend(search_items)
            
            self.logger.info(f"📰 Found {len(news_items)} recent news items for {symbol} on MoneyControl")
            return news_items
            
        except Exception as e:
            self.logger.error(f"❌ Error scraping MoneyControl for {symbol}: {e}")
            return []
    
    def _parse_moneycontrol_page(self, soup, symbol, hours_back):
        """Parse MoneyControl page for news items"""
        news_items = []
        cutoff_time = datetime.now() - timedelta(hours=hours_back)
        
        # Try multiple selectors
        selectors = [
            'div.news_gist',
            'div.newslst',
            'h2 a', 'h3 a',
            'article', 'div[class*="news"]'
        ]
        
        for selector in selectors:
            articles = soup.select(selector)
            if articles:
                break
        
        for article in articles[:15]:
            try:
                # Extract headline
                if article.name == 'a':
                    headline_elem = article
                else:
                    headline_elem = article.find('a') or article
                
                headline = headline_elem.get_text(strip=True)
                if not headline or len(headline) < 10:
                    continue
                
                # Skip if not relevant to symbol
                if symbol.lower() not in headline.lower():
                    continue
                
                # Extract link
                link = headline_elem.get('href', '') if headline_elem.name == 'a' else ''
                if link and not link.startswith('http'):
                    link = 'https://www.moneycontrol.com' + link
                
                # Create unique identifier
                news_id = f"mc_{hash(headline)}_{symbol}"
                if news_id in self.processed_news:
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
                self.processed_news.add(news_id)
                
            except Exception as e:
                continue
        
        return news_items
    
    def _search_moneycontrol_news(self, symbol, hours_back):
        """Search MoneyControl using their search functionality"""
        try:
            search_url = f"https://www.moneycontrol.com/news/business/stocks/{symbol}"
            headers = self._get_headers()
            
            response = requests.get(search_url, headers=headers, timeout=10)
            if response.status_code != 200:
                return []
            
            soup = BeautifulSoup(response.content, 'html.parser')
            return self._parse_moneycontrol_page(soup, symbol, hours_back)
            
        except Exception as e:
            self.logger.debug(f"Search failed: {e}")
            return []
    
    def scrape_google_news(self, symbol, hours_back=24):
        """Scrape Google News for broader coverage"""
        try:
            # Try multiple search strategies for better coverage
            search_queries = [
                f'"{symbol}" stock share price india',
                f'"{symbol}" order win contract',
                f'"{symbol}" earnings results',
                f'Enviro Infra Engineers' if symbol == 'EIEL' else f'{symbol} company news'
            ]
            
            all_news = []
            
            for search_query in search_queries:
                try:
                    news_items = self._search_google_with_query(search_query, symbol, hours_back)
                    all_news.extend(news_items)
                    if len(all_news) >= 10:  # Found enough news
                        break
                except Exception as e:
                    self.logger.debug(f"Search query '{search_query}' failed: {e}")
                    continue
            
            # Remove duplicates
            unique_news = []
            seen_headlines = set()
            for news in all_news:
                headline_key = news['headline'][:50]  # First 50 chars as key
                if headline_key not in seen_headlines:
                    unique_news.append(news)
                    seen_headlines.add(headline_key)
            
            self.logger.info(f"📰 Found {len(unique_news)} relevant news items for {symbol} on Google News")
            return unique_news
            
        except Exception as e:
            self.logger.error(f"❌ Error scraping Google News for {symbol}: {e}")
            return []
    
    def _search_google_with_query(self, search_query, symbol, hours_back):
        """Search Google News with a specific query"""
        try:
            encoded_query = quote_plus(search_query)
            
            url = f"https://news.google.com/search?q={encoded_query}&hl=en-IN&gl=IN&ceid=IN:en"
            headers = self._get_headers()
            
            response = requests.get(url, headers=headers, timeout=10)
            
            if response.status_code != 200:
                self.logger.debug(f"Google News returned status {response.status_code} for query: {search_query}")
                return []
            
            soup = BeautifulSoup(response.content, 'html.parser')
            news_items = []
            
            # Find news articles with multiple selectors
            selectors = ['article', 'div[class*="article"]', 'div[class*="story"]']
            articles = []
            
            for selector in selectors:
                articles = soup.select(selector)
                if articles:
                    break
            
            cutoff_time = datetime.now() - timedelta(hours=hours_back)
            
            for article in articles[:20]:  # Increased limit
                try:
                    # Extract headline
                    headline_elem = (article.find('h3') or 
                                   article.find('h2') or 
                                   article.find('h4') or
                                   article.find('a'))
                    
                    if not headline_elem:
                        continue
                    
                    headline = headline_elem.get_text(strip=True)
                    if not headline or len(headline) < 10:
                        continue
                    
                    # More flexible symbol matching
                    symbol_variations = [symbol.lower()]
                    if symbol == 'EIEL':
                        symbol_variations.extend(['enviro infra', 'eiel', 'enviro infra engineers'])
                    
                    # Check if headline contains symbol or company name
                    is_relevant = any(var in headline.lower() for var in symbol_variations)
                    if not is_relevant:
                        continue
                    
                    # Extract link
                    link_elem = article.find('a')
                    link = link_elem.get('href', '') if link_elem else ''
                    
                    # Create unique identifier
                    news_id = f"gn_{hash(headline)}_{symbol}"
                    if news_id in self.processed_news:
                        continue
                    
                    # Extract time (best effort)
                    time_elem = article.find('time')
                    news_time = datetime.now()
                    
                    if time_elem:
                        time_text = time_elem.get_text(strip=True)
                        news_time = self._parse_relative_time(time_text)
                    
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
                    self.processed_news.add(news_id)
                    
                except Exception as e:
                    self.logger.debug(f"Error parsing article: {e}")
                    continue
            
            return news_items
            
        except Exception as e:
            self.logger.debug(f"Error with Google search query '{search_query}': {e}")
            return []
    
    def search_web_news(self, symbol, hours_back=24):
        """Search multiple financial news websites directly"""
        try:
            news_sites = [
                'economictimes.indiatimes.com',
                'business-standard.com', 
                'financialexpress.com',
                'livemint.com',
                'ndtv.com/business'
            ]
            
            all_news = []
            
            # Search each site
            for site in news_sites:
                try:
                    site_news = self._search_financial_site(site, symbol, hours_back)
                    all_news.extend(site_news)
                    if len(all_news) >= 15:  # Limit total results
                        break
                except Exception as e:
                    self.logger.debug(f"Error searching {site}: {e}")
                    continue
            
            self.logger.info(f"📰 Found {len(all_news)} news items from financial websites for {symbol}")
            return all_news
            
        except Exception as e:
            self.logger.error(f"❌ Error in web news search for {symbol}: {e}")
            return []
    
    def _search_financial_site(self, site, symbol, hours_back):
        """Search a specific financial news site"""
        try:
            # Create search URLs for different sites
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
            
            headers = self._get_headers()
            response = requests.get(search_url, headers=headers, timeout=10)
            
            if response.status_code != 200:
                return []
            
            soup = BeautifulSoup(response.content, 'html.parser')
            news_items = []
            
            # Generic selectors that work across most news sites
            selectors = [
                'h1 a', 'h2 a', 'h3 a',
                '.headline a', '.title a',
                'article h2', 'article h3',
                '[class*="headline"]', '[class*="title"]'
            ]
            
            articles = []
            for selector in selectors:
                articles = soup.select(selector)
                if len(articles) >= 5:  # Found enough articles
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
                    
                    # Check relevance
                    symbol_variations = [symbol.lower()]
                    if symbol == 'EIEL':
                        symbol_variations.extend(['enviro infra', 'eiel'])
                    
                    is_relevant = any(var in headline.lower() for var in symbol_variations)
                    if not is_relevant:
                        continue
                    
                    # Fix relative links
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
                        'timestamp': datetime.now(),  # Default to now
                        'content': '',
                        'id': f"web_{hash(headline)}_{symbol}"
                    }
                    
                    news_items.append(news_item)
                    
                except Exception as e:
                    continue
            
            return news_items[:5]  # Limit per site
            
        except Exception as e:
            self.logger.debug(f"Error searching {site}: {e}")
            return []
    
    def _parse_relative_time(self, time_text):
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
    
    def analyze_sentiment(self, news_item):
        """Analyze sentiment of a news item"""
        try:
            text = (news_item['headline'] + ' ' + news_item.get('content', '')).lower()
            symbol = news_item.get('symbol', '')
            
            # Count positive and negative keywords
            positive_count = sum(1 for keyword in self.positive_keywords if keyword in text)
            negative_count = sum(1 for keyword in self.negative_keywords if keyword in text)
            
            # Add symbol-specific keywords
            if symbol == 'EIEL':
                eiel_positive = sum(1 for keyword in self.eiel_positive_keywords if keyword in text)
                positive_count += eiel_positive * 2  # Weight EIEL-specific keywords higher
            
            # Check for high-impact keywords and financial amounts
            impact_multiplier = 1.0
            financial_impact = False
            
            # Look for financial amounts (₹X crore, etc.)
            import re
            amount_pattern = r'₹\s*(\d+)\s*crore|rs\s*(\d+)\s*crore|\$\s*(\d+)\s*million'
            amount_matches = re.findall(amount_pattern, text, re.IGNORECASE)
            
            if amount_matches:
                # Extract the amount and boost sentiment based on size
                amounts = [int(match[0] or match[1] or match[2]) for match in amount_matches if any(match)]
                if amounts:
                    max_amount = max(amounts)
                    if max_amount >= 100:  # ₹100 crore or more
                        impact_multiplier = 2.0
                        financial_impact = True
                    elif max_amount >= 50:   # ₹50-99 crore
                        impact_multiplier = 1.7
                        financial_impact = True
                    elif max_amount >= 10:   # ₹10-49 crore  
                        impact_multiplier = 1.4
                        financial_impact = True
            
            # Check for other high-impact keywords
            for keyword in self.high_impact_keywords:
                if keyword in text:
                    impact_multiplier = max(impact_multiplier, 1.5)
                    break
            
            # Calculate base sentiment
            if positive_count > negative_count:
                sentiment_score = (positive_count - negative_count) / max(positive_count + negative_count, 1)
            elif negative_count > positive_count:
                sentiment_score = -(negative_count - positive_count) / max(positive_count + negative_count, 1)
            else:
                sentiment_score = 0.0
            
            # Boost sentiment for financial news
            if financial_impact and sentiment_score > 0:
                sentiment_score = min(1.0, sentiment_score * 1.3)  # Extra boost for good financial news
            
            # Apply impact multiplier
            sentiment_score *= impact_multiplier
            
            # Apply time decay (recent news more important)
            time_weight = self._calculate_time_weight(news_item['timestamp'])
            final_score = sentiment_score * time_weight
            
            # Clamp between -1 and 1
            final_score = max(-1.0, min(1.0, final_score))
            
            # Calculate confidence based on multiple factors
            confidence = min(abs(final_score) + 0.3, 1.0)
            if financial_impact:
                confidence = min(confidence + 0.2, 1.0)  # Higher confidence for financial news
            
            return {
                'sentiment_score': final_score,
                'positive_keywords': positive_count,
                'negative_keywords': negative_count,
                'impact_multiplier': impact_multiplier,
                'time_weight': time_weight,
                'confidence': confidence,
                'financial_impact': financial_impact,
                'detected_amounts': amount_matches
            }
            
        except Exception as e:
            self.logger.error(f"❌ Error analyzing sentiment: {e}")
            return {
                'sentiment_score': 0.0,
                'positive_keywords': 0,
                'negative_keywords': 0,
                'impact_multiplier': 1.0,
                'time_weight': 1.0,
                'confidence': 0.0,
                'financial_impact': False,
                'detected_amounts': []
            }
    
    def _calculate_time_weight(self, timestamp):
        """Calculate weight based on how recent the news is"""
        try:
            age_hours = (datetime.now() - timestamp).total_seconds() / 3600
            
            if age_hours < 1:
                return 1.0  # Very recent
            elif age_hours < 4:
                return 0.8  # Recent
            elif age_hours < 12:
                return 0.6  # Somewhat recent
            elif age_hours < 24:
                return 0.4  # Within day
            else:
                return 0.2  # Older
        except:
            return 0.5
    
    def predict_volume_impact(self, sentiment_analysis, symbol):
        """Predict if news will cause volume spike"""
        try:
            score = sentiment_analysis['sentiment_score']
            confidence = sentiment_analysis['confidence']
            impact = sentiment_analysis['impact_multiplier']
            
            # Calculate impact probability
            impact_score = abs(score) * confidence * impact
            
            if impact_score > 0.8:
                prediction = "HIGH_VOLUME_EXPECTED"
                probability = min(0.9, impact_score)
            elif impact_score > 0.5:
                prediction = "MODERATE_VOLUME_EXPECTED"  
                probability = min(0.7, impact_score)
            elif impact_score > 0.3:
                prediction = "LOW_VOLUME_EXPECTED"
                probability = min(0.5, impact_score)
            else:
                prediction = "NO_SIGNIFICANT_IMPACT"
                probability = impact_score
            
            return {
                'prediction': prediction,
                'probability': probability,
                'impact_score': impact_score,
                'sentiment_direction': 'BULLISH' if score > 0 else 'BEARISH' if score < 0 else 'NEUTRAL'
            }
            
        except Exception as e:
            self.logger.error(f"❌ Error predicting volume impact: {e}")
            return {
                'prediction': "NO_SIGNIFICANT_IMPACT",
                'probability': 0.0,
                'impact_score': 0.0,
                'sentiment_direction': 'NEUTRAL'
            }
    
    def scan_stock_news(self, symbol, hours_back=2):
        """Comprehensive news scanning for a specific stock"""
        try:
            self.logger.info(f"🔍 Scanning news for {symbol} (last {hours_back} hours)")
            
            all_news = []
            
            # Scrape from multiple sources
            mc_news = self.scrape_moneycontrol_news(symbol, hours_back)
            all_news.extend(mc_news)
            
            gn_news = self.scrape_google_news(symbol, hours_back)
            all_news.extend(gn_news)
            
            # Add direct web search for broader coverage
            web_news = self.search_web_news(symbol, hours_back)
            all_news.extend(web_news)
            
            if not all_news:
                self.logger.info(f"📰 No recent news found for {symbol}")
                return []
            
            # Analyze sentiment for each news item
            analyzed_news = []
            for news_item in all_news:
                sentiment = self.analyze_sentiment(news_item)
                volume_prediction = self.predict_volume_impact(sentiment, symbol)
                
                news_item.update({
                    'sentiment_analysis': sentiment,
                    'volume_prediction': volume_prediction
                })
                
                analyzed_news.append(news_item)
            
            # Sort by impact score (most impactful first)
            analyzed_news.sort(key=lambda x: x['volume_prediction']['impact_score'], reverse=True)
            
            self.logger.info(f"📊 Analyzed {len(analyzed_news)} news items for {symbol}")
            return analyzed_news
            
        except Exception as e:
            self.logger.error(f"❌ Error scanning news for {symbol}: {e}")
            return []
    
    def generate_alert(self, symbol, news_items):
        """Generate trading alert based on news analysis"""
        try:
            if not news_items:
                return None
            
            # Find highest impact news
            top_news = news_items[0]
            sentiment = top_news['sentiment_analysis']
            prediction = top_news['volume_prediction']
            
            # Only generate alerts for significant impact
            if prediction['impact_score'] < 0.5:
                return None
            
            alert = {
                'symbol': symbol,
                'timestamp': datetime.now(),
                'alert_type': 'NEWS_SENTIMENT',
                'headline': top_news['headline'][:100] + '...',
                'source': top_news['source'],
                'sentiment_score': sentiment['sentiment_score'],
                'confidence': sentiment['confidence'],
                'volume_prediction': prediction['prediction'],
                'probability': prediction['probability'],
                'direction': prediction['sentiment_direction'],
                'urgency': 'HIGH' if prediction['impact_score'] > 0.7 else 'MEDIUM',
                'action': 'PREPARE_FOR_ENTRY' if prediction['sentiment_direction'] == 'BULLISH' else 'AVOID_OR_SHORT'
            }
            
            return alert
            
        except Exception as e:
            self.logger.error(f"❌ Error generating alert: {e}")
            return None
    
    def test_eiel_analysis(self):
        """Test case: Analyze EIEL news for validation"""
        self.logger.info("🧪 Testing news analysis with multiple stocks...")
        
        # Test with EIEL first
        self.logger.info("📊 Testing EIEL...")
        eiel_news = self.scan_stock_news('EIEL', hours_back=48)
        
        # Also test with a popular stock to validate scraper works
        self.logger.info("📊 Testing RELIANCE (to validate scraper)...")
        reliance_news = self.scan_stock_news('RELIANCE', hours_back=24)
        
        # Test with TCS as well
        self.logger.info("📊 Testing TCS...")
        tcs_news = self.scan_stock_news('TCS', hours_back=24)
        
        # Combine all for reporting
        all_tests = [
            ('EIEL', eiel_news),
            ('RELIANCE', reliance_news), 
            ('TCS', tcs_news)
        ]
        
        for symbol, news_items in all_tests:
            self._report_analysis_results(symbol, news_items)
    
    def _report_analysis_results(self, symbol, news_items):
        """Report analysis results for a symbol"""
        if not news_items:
            self.logger.warning(f"⚠️ No recent news found for {symbol}")
            return
        
        self.logger.info(f"📊 {symbol} News Analysis Results:")
        self.logger.info(f"   Total news items: {len(news_items)}")
        
        for i, news in enumerate(news_items[:3], 1):  # Show top 3
            sentiment = news['sentiment_analysis']
            prediction = news['volume_prediction']
            
            self.logger.info(f"\n   {i}. {news['headline'][:80]}...")
            self.logger.info(f"      Source: {news['source']}")
            self.logger.info(f"      Sentiment: {sentiment['sentiment_score']:.2f} (confidence: {sentiment['confidence']:.1%})")
            self.logger.info(f"      Volume Impact: {prediction['prediction']} ({prediction['probability']:.1%})")
            self.logger.info(f"      Direction: {prediction['sentiment_direction']}")
        
        # Generate alert if applicable
        alert = self.generate_alert(symbol, news_items)
        if alert:
            self.logger.info(f"\n🚨 ALERT GENERATED FOR {symbol}:")
            self.logger.info(f"   📰 {alert['headline']}")
            self.logger.info(f"   📊 Sentiment: {alert['sentiment_score']:.2f} ({alert['direction']})")
            self.logger.info(f"   📈 Volume: {alert['volume_prediction']} ({alert['probability']:.1%})")
            self.logger.info(f"   ⚡ Action: {alert['action']}")
        else:
            self.logger.info(f"\n📝 No alert generated for {symbol} (impact too low)")
        
        self.logger.info("-" * 60)

def main():
    """Test the news analyzer"""
    print("📰 News Sentiment Analyzer - Early Signal Detection")
    print("=" * 60)
    
    analyzer = NewsAnalyzer()
    
    # Test with EIEL
    analyzer.test_eiel_analysis()
    
    print("\n" + "=" * 60)
    print("✅ News analyzer test complete!")
    print("\n💡 Next steps:")
    print("   1. Integrate with volatility scanner")
    print("   2. Set up real-time monitoring")
    print("   3. Add Telegram alerts")
    print("   4. Monitor correlation with volume spikes")

if __name__ == "__main__":
    main()
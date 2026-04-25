#!/usr/bin/env python3
"""
Sentiment Analyzer - Main NewsSentimentAnalyzer class
"""

import logging
import re
from datetime import datetime, timedelta

from upstox_trader.analyzers.news.sentiment_models import (
    POSITIVE_KEYWORDS,
    NEGATIVE_KEYWORDS,
    HIGH_IMPACT_KEYWORDS,
    NEWS_SOURCES,
)
from upstox_trader.analyzers.news.sentiment_api import (
    get_tv_cookies,
    scrape_moneycontrol_news,
    scrape_google_news,
    search_web_news,
)
from upstox_trader.analyzers.news.sentiment_utils import (
    setup_news_logging,
)


class NewsSentimentAnalyzer:
    """Early news detection system for trading signals"""

    def __init__(self, debug=False):
        log_level = logging.DEBUG if debug else logging.WARNING
        logging.basicConfig(level=log_level, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        self.logger = logging.getLogger('NewsSentimentAnalyzer')
        self.debug_mode = debug

        self.tv_cookies = get_tv_cookies(debug, self.logger)

        self.news_sources = NEWS_SOURCES

        self.processed_news = set()

        logging_config = setup_news_logging(debug, self.logger)
        self.news_dir = logging_config['news_dir']
        self.daily_log_file = logging_config['daily_log_file']
        self.session_log_file = logging_config['session_log_file']
        self.csv_headers = logging_config['csv_headers']
        self.session_id = logging_config['session_id']

        self.positive_keywords = POSITIVE_KEYWORDS
        self.negative_keywords = NEGATIVE_KEYWORDS
        self.high_impact_keywords = HIGH_IMPACT_KEYWORDS

    def analyze_sentiment(self, news_item):
        """Analyze sentiment of a news item"""
        try:
            text = (news_item['headline'] + ' ' + news_item.get('content', '')).lower()
            symbol = news_item.get('symbol', '')

            positive_count = sum(1 for keyword in self.positive_keywords if keyword in text)
            negative_count = sum(1 for keyword in self.negative_keywords if keyword in text)

            impact_multiplier = 1.0
            financial_impact = False

            amount_pattern = r'₹\s*(\d+)\s*crore|rs\s*(\d+)\s*crore|\$\s*(\d+)\s*million'
            amount_matches = re.findall(amount_pattern, text, re.IGNORECASE)

            if amount_matches:
                amounts = [int(match[0] or match[1] or match[2]) for match in amount_matches if any(match)]
                if amounts:
                    max_amount = max(amounts)
                    if max_amount >= 100:
                        impact_multiplier = 2.0
                        financial_impact = True
                    elif max_amount >= 50:
                        impact_multiplier = 1.7
                        financial_impact = True
                    elif max_amount >= 10:
                        impact_multiplier = 1.4
                        financial_impact = True

            for keyword in self.high_impact_keywords:
                if keyword in text:
                    impact_multiplier = max(impact_multiplier, 1.5)
                    break

            if positive_count > negative_count:
                sentiment_score = (positive_count - negative_count) / max(positive_count + negative_count, 1)
            elif negative_count > positive_count:
                sentiment_score = -(negative_count - positive_count) / max(positive_count + negative_count, 1)
            else:
                sentiment_score = 0.0

            if financial_impact and sentiment_score > 0:
                sentiment_score = min(1.0, sentiment_score * 1.3)

            sentiment_score *= impact_multiplier

            time_weight = self._calculate_time_weight(news_item['timestamp'])
            final_score = sentiment_score * time_weight

            final_score = max(-1.0, min(1.0, final_score))

            confidence = min(abs(final_score) + 0.3, 1.0)
            if financial_impact:
                confidence = min(confidence + 0.2, 1.0)

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
                return 1.0
            elif age_hours < 4:
                return 0.8
            elif age_hours < 12:
                return 0.6
            elif age_hours < 24:
                return 0.4
            else:
                return 0.2
        except:
            return 0.5

    def predict_volume_impact(self, sentiment_analysis, symbol):
        """Predict if news will cause volume spike"""
        try:
            score = sentiment_analysis['sentiment_score']
            confidence = sentiment_analysis['confidence']
            impact = sentiment_analysis['impact_multiplier']

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
            if self.debug_mode:
                self.logger.info(f"🔍 Scanning news for {symbol} (last {hours_back} hours)")

            all_news = []

            mc_news = scrape_moneycontrol_news(symbol, hours_back, self.processed_news, self.debug_mode, self.logger)
            all_news.extend(mc_news)

            gn_news = scrape_google_news(symbol, hours_back, self.processed_news, self.debug_mode, self.logger)
            all_news.extend(gn_news)

            web_news = search_web_news(symbol, hours_back, self.processed_news, self.debug_mode, self.logger)
            all_news.extend(web_news)

            if not all_news:
                if self.debug_mode:
                    self.logger.info(f"📰 No recent news found for {symbol}")
                return []

            analyzed_news = []
            for news_item in all_news:
                sentiment = self.analyze_sentiment(news_item)
                volume_prediction = self.predict_volume_impact(sentiment, symbol)

                news_item.update({
                    'sentiment_analysis': sentiment,
                    'volume_prediction': volume_prediction
                })

                analyzed_news.append(news_item)

            analyzed_news.sort(key=lambda x: x['volume_prediction']['impact_score'], reverse=True)

            if self.debug_mode:
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

            top_news = news_items[0]
            sentiment = top_news['sentiment_analysis']
            prediction = top_news['volume_prediction']

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


NewsAnalyzer = NewsSentimentAnalyzer

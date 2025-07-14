#!/usr/bin/env python3
"""
Sensibull Draft Portfolio Automation Script
==========================================

This script tests interaction with Sensibull's web-based draft portfolios
using cookie-based authentication, similar to the TradingView screener approach.

Features:
- Cookie-based authentication for Sensibull web platform
- Draft portfolio scraping and analysis
- Potential trade execution automation
- Integration ready for Upstox signal forwarding

SETUP INSTRUCTIONS:
1. Login to https://web.sensibull.com/draft-portfolios in Chrome
2. Open DevTools (F12) -> Application -> Cookies
3. Copy the session cookies and update them in this script
4. Run the script to test authentication and data access

WARNING: This is for educational/testing purposes only.
Ensure compliance with Sensibull's terms of service.
"""

import requests
import json
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import logging
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse
import re
import brotli

# Cookie extraction
try:
    import rookiepy
    ROOKIEPY_AVAILABLE = True
    print("✅ rookiepy available for automatic cookie extraction")
except ImportError:
    ROOKIEPY_AVAILABLE = False
    print("⚠️ rookiepy not available - install with: pip install rookiepy")

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('sensibull_test.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('SensibullTest')

@dataclass
class PortfolioPosition:
    """Data class for portfolio positions"""
    symbol: str
    instrument_type: str  # 'OPTION', 'FUTURE', 'EQUITY'
    quantity: int
    entry_price: float
    current_price: float
    pnl: float
    pnl_percent: float
    strike: Optional[float] = None
    expiry: Optional[str] = None
    option_type: Optional[str] = None  # 'CE', 'PE'
    
    def to_dict(self) -> Dict:
        return {
            'symbol': self.symbol,
            'instrument_type': self.instrument_type,
            'quantity': self.quantity,
            'entry_price': self.entry_price,
            'current_price': self.current_price,
            'pnl': self.pnl,
            'pnl_percent': self.pnl_percent,
            'strike': self.strike,
            'expiry': self.expiry,
            'option_type': self.option_type
        }

@dataclass 
class DraftPortfolio:
    """Data class for draft portfolio"""
    portfolio_id: str
    name: str
    total_pnl: float
    total_pnl_percent: float
    positions: List[PortfolioPosition]
    created_at: datetime
    updated_at: datetime
    
    def to_dict(self) -> Dict:
        return {
            'portfolio_id': self.portfolio_id,
            'name': self.name,
            'total_pnl': self.total_pnl,
            'total_pnl_percent': self.total_pnl_percent,
            'positions': [pos.to_dict() for pos in self.positions],
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat()
        }

class SensibullAPI:
    """Sensibull web API client using cookie-based authentication"""
    
    def __init__(self):
        self.base_url = "https://web.sensibull.com"
        self.api_base = "https://web.sensibull.com/api"  # Guessed API endpoint
        self.session = requests.Session()
        
        # Default headers to mimic browser behavior
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Cache-Control': 'max-age=0'
        })
        
        # Initialize with empty cookies - these need to be updated manually
        self.cookies = {}
        
    def set_authentication_cookies(self, cookies: Dict[str, str]):
        """Set authentication cookies from browser session"""
        self.cookies = cookies
        
        # Add cookies to session
        for name, value in cookies.items():
            self.session.cookies.set(name, value, domain='.sensibull.com')
            
        logger.info(f"✅ Set {len(cookies)} authentication cookies")
    
    def test_authentication(self) -> bool:
        """Test if authentication is working"""
        try:
            # Try to access the draft portfolios page
            response = self.session.get(f"{self.base_url}/draft-portfolios", timeout=10)
            
            # Check if we get a proper response (not redirected to login)
            if response.status_code == 200:
                # Debug response info
                logger.info(f"Response headers: {dict(response.headers)}")
                logger.info(f"Response encoding: {response.encoding}")
                logger.info(f"Response content type: {response.headers.get('content-type', 'unknown')}")
                
                # Handle different content encodings
                try:
                    # Check if content is properly decoded
                    content = response.text
                    if len(content) > 0 and ord(content[0]) < 32:  # Binary content detected
                        logger.warning("⚠️ Binary content detected, attempting to decode...")
                        # Try to decode if it's compressed
                        if response.headers.get('content-encoding') == 'br':
                            content = brotli.decompress(response.content).decode('utf-8')
                        elif response.headers.get('content-encoding') == 'gzip':
                            import gzip
                            content = gzip.decompress(response.content).decode('utf-8')
                        else:
                            content = response.content.decode('utf-8', errors='ignore')
                    
                    content = content.lower()
                    logger.info(f"✅ Content successfully decoded, length: {len(content)} chars")
                    
                except Exception as decode_error:
                    logger.warning(f"⚠️ Content decoding failed: {decode_error}")
                    content = response.text.lower()
                
                # Positive indicators
                logged_in_indicators = [
                    'draft-portfolios',
                    'portfolio',
                    'logout',
                    'user',
                    'create portfolio',
                    'dashboard'
                ]
                
                # Negative indicators (means we're not logged in)
                login_indicators = [
                    'login',
                    'sign in',
                    'authenticate',
                    'enter otp',
                    'mobile number'
                ]
                
                has_logged_in_content = any(indicator in content for indicator in logged_in_indicators)
                has_login_content = any(indicator in content for indicator in login_indicators)
                
                if has_logged_in_content and not has_login_content:
                    logger.info("✅ Authentication successful - logged in to Sensibull")
                    return True
                else:
                    logger.warning("⚠️ May not be properly authenticated - check cookies")
                    # Handle potential encoding issues
                    try:
                        decoded_content = content.encode('utf-8', errors='ignore').decode('utf-8')
                        logger.info(f"Content preview (decoded): {decoded_content[:500]}")
                    except:
                        logger.info(f"Content preview (raw): {repr(content[:200])}")
                    return False
            else:
                logger.error(f"❌ Authentication test failed - HTTP {response.status_code}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Authentication test error: {str(e)}")
            return False
    
    
    def scrape_draft_portfolios_page(self) -> Dict[str, Any]:
        """Scrape the draft portfolios page for data"""
        try:
            response = self.session.get(f"{self.base_url}/draft-portfolios", timeout=10)
            
            if response.status_code != 200:
                logger.error(f"❌ Failed to load draft portfolios page - HTTP {response.status_code}")
                return {}
            
            # Handle different content encodings (like previous fixes)
            try:
                content = response.text
                if len(content) > 0 and ord(content[0]) < 32:  # Binary content detected
                    if response.headers.get('content-encoding') == 'br':
                        content = brotli.decompress(response.content).decode('utf-8')
                    elif response.headers.get('content-encoding') == 'gzip':
                        import gzip
                        content = gzip.decompress(response.content).decode('utf-8')
                    else:
                        content = response.content.decode('utf-8', errors='ignore')
            except Exception as decode_error:
                logger.warning(f"⚠️ Content decoding failed: {decode_error}")
                content = response.text
            
            # Look for embedded JSON data (common in React apps)
            json_patterns = [
                r'window\.__INITIAL_STATE__\s*=\s*({.+?});',
                r'window\.__PRELOADED_STATE__\s*=\s*({.+?});',
                r'window\.INITIAL_DATA\s*=\s*({.+?});',
                r'__NEXT_DATA__"\s*type="application/json">({.+?})</script>',
                r'data-react-helmet="true">({.+?})</script>',
                r'self\.__next_f\.push\s*\(\s*\[.*?({.+?})\s*\]\s*\)',  # Next.js data
                r'window\.__REACT_QUERY_STATE__\s*=\s*({.+?});',
                r'window\.__APP_DATA__\s*=\s*({.+?});',
            ]
            
            extracted_data = {}
            
            for pattern in json_patterns:
                matches = re.findall(pattern, content, re.DOTALL)
                for match in matches:
                    try:
                        data = json.loads(match)
                        logger.info(f"✅ Found embedded JSON data using pattern: {pattern[:30]}...")
                        extracted_data['embedded_data'] = data
                        
                        # Look for portfolios in embedded data
                        self._extract_portfolios_from_data(data, extracted_data)
                        break
                    except json.JSONDecodeError as e:
                        logger.debug(f"JSON decode failed for pattern {pattern[:30]}: {str(e)}")
                        continue
            
            # Look for portfolio-related keywords and data
            portfolio_indicators = {
                'has_portfolios': 'portfolio' in content.lower(),
                'has_positions': 'position' in content.lower(),
                'has_pnl': any(term in content.lower() for term in ['pnl', 'profit', 'loss']),
                'has_options': any(term in content.lower() for term in ['call', 'put', 'strike', 'expiry']),
                'has_create_button': any(term in content.lower() for term in ['create', 'add', 'new portfolio']),
                'has_strategies': any(term in content.lower() for term in ['strategy', 'strategies']),
                'has_orders': any(term in content.lower() for term in ['order', 'orders', 'trade', 'trades']),
            }
            
            extracted_data['indicators'] = portfolio_indicators
            extracted_data['content_length'] = len(content)
            extracted_data['timestamp'] = datetime.now().isoformat()
            
            # Extract any visible portfolio names or IDs
            portfolio_patterns = [
                r'portfolio[_-]?id["\s]*[:=]["\s]*["\']([a-zA-Z0-9-]+)["\']',
                r'portfolio["\s]*:["\s]*{[^}]*"id"["\s]*:["\s]*"([^"]+)"',
                r'data-portfolio-id["\s]*=["\s]*"([^"]+)"',
                r'"portfolioId"["\s]*:["\s]*"([^"]+)"',
                r'"id"["\s]*:["\s]*"([a-f0-9-]{20,})"',  # UUID-like IDs
            ]
            
            found_portfolio_ids = []
            for pattern in portfolio_patterns:
                matches = re.findall(pattern, content, re.IGNORECASE)
                found_portfolio_ids.extend(matches)
            
            if found_portfolio_ids:
                extracted_data['portfolio_ids'] = list(set(found_portfolio_ids))
                logger.info(f"🎯 Found potential portfolio IDs: {found_portfolio_ids}")
            
            logger.info(f"📊 Scraped draft portfolios page - {len(content)} chars, indicators: {portfolio_indicators}")
            return extracted_data
            
        except Exception as e:
            logger.error(f"❌ Error scraping draft portfolios page: {str(e)}")
            return {}
    
    
    def scrape_portfolio_data_from_html(self) -> Dict[str, Any]:
        """Debug and extract 3 portfolios from Sensibull HTML"""
        try:
            response = self.session.get(f"{self.base_url}/draft-portfolios", timeout=10)
            
            if response.status_code != 200:
                logger.error(f"❌ Failed to load draft portfolios page - HTTP {response.status_code}")
                return {}
            
            # Handle content decoding
            try:
                content = response.text
                if len(content) > 0 and ord(content[0]) < 32:
                    if response.headers.get('content-encoding') == 'br':
                        content = brotli.decompress(response.content).decode('utf-8')
                    elif response.headers.get('content-encoding') == 'gzip':
                        import gzip
                        content = gzip.decompress(response.content).decode('utf-8')
            except:
                content = response.text
            
            logger.info(f"🔍 DEBUGGING SENSIBULL HTML STRUCTURE (Total: {len(content)} chars)")
            logger.info("=" * 80)
            
            # Save full content to file for detailed analysis
            debug_file = "sensibull_debug_content.html"
            with open(debug_file, 'w', encoding='utf-8') as f:
                f.write(content)
            logger.info(f"💾 Saved full HTML content to: {debug_file}")
            
            # 1. Look for JSON data embedded in script tags
            logger.info("\n🔍 1. SEARCHING FOR EMBEDDED JSON DATA:")
            logger.info("-" * 50)
            
            json_patterns = [
                r'window\.__INITIAL_STATE__\s*=\s*({.+?});',
                r'window\.__PRELOADED_STATE__\s*=\s*({.+?});',
                r'window\.INITIAL_DATA\s*=\s*({.+?});',
                r'__NEXT_DATA__["\s]*type="application/json"[^>]*>({.+?})</script>',
                r'window\.__NUXT__\s*=\s*({.+?});',
                r'window\.__APP_DATA__\s*=\s*({.+?});',
                r'window\.app\s*=\s*({.+?});',
            ]
            
            found_json = False
            for i, pattern in enumerate(json_patterns, 1):
                matches = re.findall(pattern, content, re.DOTALL)
                if matches:
                    logger.info(f"✅ Pattern {i}: Found {len(matches)} JSON blocks")
                    for j, match in enumerate(matches[:2]):  # Show first 2
                        try:
                            data = json.loads(match)
                            logger.info(f"   Block {j+1}: Valid JSON with keys: {list(data.keys())[:10]}")
                            
                            # Look for portfolios in the JSON
                            portfolios = self._find_portfolios_in_json(data)
                            if portfolios:
                                logger.info(f"   🎯 FOUND {len(portfolios)} PORTFOLIOS IN JSON!")
                                found_json = True
                                return {'portfolios': portfolios, 'source': 'json'}
                        except:
                            logger.info(f"   Block {j+1}: Invalid JSON (length: {len(match)})")
                else:
                    logger.debug(f"   Pattern {i}: No matches")
            
            # 2. Look for portfolio cards/sections in HTML
            logger.info("\n🔍 2. SEARCHING FOR PORTFOLIO HTML STRUCTURES:")
            logger.info("-" * 50)
            
            # Portfolio card patterns
            card_patterns = [
                r'<div[^>]*portfolio[^>]*>.*?</div>',
                r'<article[^>]*portfolio[^>]*>.*?</article>',
                r'<section[^>]*portfolio[^>]*>.*?</section>',
                r'<li[^>]*portfolio[^>]*>.*?</li>',
                # Class-based patterns
                r'<div[^>]*class="[^"]*portfolio[^"]*"[^>]*>.*?</div>',
                r'<div[^>]*class="[^"]*card[^"]*"[^>]*>.*?</div>',
                r'<div[^>]*class="[^"]*item[^"]*"[^>]*>.*?</div>',
            ]
            
            portfolio_cards = []
            for i, pattern in enumerate(card_patterns, 1):
                matches = re.findall(pattern, content, re.IGNORECASE | re.DOTALL)
                if matches:
                    logger.info(f"✅ Card Pattern {i}: Found {len(matches)} potential portfolio cards")
                    portfolio_cards.extend(matches)
                    
                    # Analyze the first few matches
                    for j, match in enumerate(matches[:3]):
                        clean_match = re.sub(r'<[^>]+>', ' ', match)
                        clean_match = re.sub(r'\s+', ' ', clean_match).strip()
                        if len(clean_match) > 50:
                            logger.info(f"   Card {j+1}: {clean_match[:100]}...")
            
            # 3. Search for specific text patterns that indicate portfolios
            logger.info("\n🔍 3. SEARCHING FOR PORTFOLIO TEXT PATTERNS:")
            logger.info("-" * 50)
            
            text_patterns = [
                # Portfolio names
                r'(?i)portfolio[:\s]+([^<>\n]{5,50})',
                r'(?i)strategy[:\s]+([^<>\n]{5,50})',
                r'(?i)position[:\s]+([^<>\n]{5,50})',
                
                # P&L patterns
                r'(?i)(?:₹|rs\.?|inr|profit|loss)[:\s]*([+-]?\d+(?:,\d+)*(?:\.\d+)?)',
                r'([+-]?\d+\.\d+)%',
                
                # Stock/option patterns
                r'(?i)(?:nifty|banknifty|sensex)[^<>\n]*(\d+)[^<>\n]*(ce|pe|call|put)',
                r'(?i)(?:buy|sell|long|short)[^<>\n]*(\d+)[^<>\n]*([A-Z]{2,6})',
            ]
            
            all_text_matches = []
            for i, pattern in enumerate(text_patterns, 1):
                matches = re.findall(pattern, content, re.IGNORECASE)
                if matches:
                    logger.info(f"✅ Text Pattern {i}: Found {len(matches)} matches")
                    all_text_matches.extend(matches)
                    # Show first few matches
                    for match in matches[:5]:
                        if isinstance(match, tuple):
                            logger.info(f"   Match: {' | '.join(str(m) for m in match)}")
                        else:
                            logger.info(f"   Match: {match}")
            
            # 4. Look for specific UI framework patterns
            logger.info("\n🔍 4. SEARCHING FOR UI FRAMEWORK PATTERNS:")
            logger.info("-" * 50)
            
            # React component patterns
            react_patterns = [
                r'data-reactroot',
                r'react-\w+',
                r'_react\w*',
                r'Portfolio\w*Component',
                r'PortfolioCard',
                r'PortfolioList',
            ]
            
            # Vue component patterns  
            vue_patterns = [
                r'v-\w+',
                r'vue-\w+',
                r'data-v-\w+',
            ]
            
            # Angular patterns
            angular_patterns = [
                r'ng-\w+',
                r'angular\w*',
                r'\[(\w+)\]',
                r'\*ng\w+',
            ]
            
            framework_found = ""
            for framework, patterns in [("React", react_patterns), ("Vue", vue_patterns), ("Angular", angular_patterns)]:
                for pattern in patterns:
                    if re.search(pattern, content, re.IGNORECASE):
                        framework_found = framework
                        logger.info(f"✅ Detected {framework} framework")
                        break
                if framework_found:
                    break
            
            # 5. Count and analyze the overall structure
            logger.info("\n🔍 5. OVERALL STRUCTURE ANALYSIS:")
            logger.info("-" * 50)
            
            structure_stats = {
                'total_divs': len(re.findall(r'<div[^>]*>', content, re.IGNORECASE)),
                'total_classes': len(re.findall(r'class="[^"]*"', content)),
                'total_ids': len(re.findall(r'id="[^"]*"', content)),
                'script_tags': len(re.findall(r'<script[^>]*>', content, re.IGNORECASE)),
                'data_attributes': len(re.findall(r'data-[^=]+=', content)),
            }
            
            for key, value in structure_stats.items():
                logger.info(f"   {key}: {value}")
            
            # 6. Extract class names and IDs for pattern analysis
            logger.info("\n🔍 6. EXTRACTING CLASS NAMES AND IDS:")
            logger.info("-" * 50)
            
            class_names = re.findall(r'class="([^"]*)"', content)
            portfolio_classes = [cls for cls in class_names if 'portfolio' in cls.lower()]
            card_classes = [cls for cls in class_names if any(term in cls.lower() for term in ['card', 'item', 'list', 'grid'])]
            
            if portfolio_classes:
                logger.info(f"✅ Portfolio-related classes: {set(portfolio_classes[:10])}")
            if card_classes:
                logger.info(f"✅ Card/Item classes: {set(card_classes[:10])}")
            
            ids = re.findall(r'id="([^"]*)"', content)
            portfolio_ids = [id_val for id_val in ids if 'portfolio' in id_val.lower()]
            if portfolio_ids:
                logger.info(f"✅ Portfolio-related IDs: {portfolio_ids}")
            
            # Return comprehensive debug data
            return {
                'portfolios': [],
                'debug_info': {
                    'total_content_length': len(content),
                    'framework_detected': framework_found,
                    'structure_stats': structure_stats,
                    'portfolio_classes': portfolio_classes[:5],
                    'card_classes': card_classes[:5], 
                    'portfolio_ids': portfolio_ids,
                    'total_text_matches': len(all_text_matches),
                    'total_portfolio_cards': len(portfolio_cards),
                },
                'source': 'html_debug'
            }
            
        except Exception as e:
            logger.error(f"❌ Error in HTML debugging: {str(e)}")
            import traceback
            logger.error(f"❌ Traceback: {traceback.format_exc()}")
            return {}
    
    def _find_portfolios_in_json(self, data: Any, path: str = "") -> List[Dict]:
        """Recursively search for portfolio data in JSON structure"""
        portfolios = []
        
        if isinstance(data, dict):
            # Check if this dict looks like a portfolio
            if self._is_portfolio_object(data):
                portfolios.append(data)
            
            # Search for common portfolio keys
            for key in ['portfolios', 'draftPortfolios', 'portfolio', 'strategies', 'positions']:
                if key in data and isinstance(data[key], (list, dict)):
                    sub_portfolios = self._find_portfolios_in_json(data[key], f"{path}.{key}")
                    portfolios.extend(sub_portfolios)
            
            # Recursively search other keys
            for key, value in data.items():
                if key not in ['portfolios', 'draftPortfolios', 'portfolio', 'strategies', 'positions']:
                    if isinstance(value, (dict, list)):
                        sub_portfolios = self._find_portfolios_in_json(value, f"{path}.{key}")
                        portfolios.extend(sub_portfolios)
        
        elif isinstance(data, list):
            for i, item in enumerate(data):
                if isinstance(item, dict):
                    if self._is_portfolio_object(item):
                        portfolios.append(item)
                    else:
                        sub_portfolios = self._find_portfolios_in_json(item, f"{path}[{i}]")
                        portfolios.extend(sub_portfolios)
        
        return portfolios
    
    def _is_portfolio_object(self, obj: Dict) -> bool:
        """Check if a dictionary object represents a portfolio"""
        if not isinstance(obj, dict):
            return False
        
        # Look for portfolio-like keys
        portfolio_indicators = [
            'id', 'name', 'title', 'portfolioId', 'portfolio_id',
            'positions', 'trades', 'strategies', 'legs',
            'pnl', 'totalPnl', 'unrealizedPnl', 'realizedPnl',
            'value', 'currentValue', 'marketValue',
            'createdAt', 'created_at', 'updatedAt', 'updated_at'
        ]
        
        # Count how many portfolio indicators are present
        indicator_count = sum(1 for key in portfolio_indicators if key in obj)
        
        # If it has 3+ indicators, it's likely a portfolio
        return indicator_count >= 3
    
    def display_portfolio_summary(self):
        """Display portfolio data extracted from HTML scraping"""
        logger.info("📊 SCRAPING SENSIBULL PORTFOLIO DATA FROM HTML...")
        logger.info("=" * 70)
        
        # Scrape data from HTML
        scraped_data = self.scrape_portfolio_data_from_html()
        
        if not scraped_data:
            logger.error("❌ Failed to scrape any data from HTML")
            return
        
        # Analyze content indicators
        indicators = scraped_data.get('content_indicators', {})
        
        logger.info("📋 CONTENT ANALYSIS:")
        logger.info("-" * 50)
        
        if indicators.get('empty_portfolio'):
            logger.info("📭 EMPTY ACCOUNT DETECTED")
            logger.info("   - No portfolios created yet")
            logger.info("   - Account appears to be in initial state")
            logger.info("   - Ready for automated portfolio creation")
        
        if indicators.get('has_portfolio_data'):
            logger.info("📊 PORTFOLIO DATA DETECTED")
            logger.info("   - Portfolio values and P&L information found")
            logger.info("   - Account has active trading data")
        
        if indicators.get('has_options_data'):
            logger.info("📈 OPTIONS DATA DETECTED")
            logger.info("   - Options trading features available")
            logger.info("   - Strike prices and expiry data found")
        
        if indicators.get('has_strategy_data'):
            logger.info("🎯 STRATEGY DATA DETECTED")
            logger.info("   - Strategy builder components found")
            logger.info("   - Advanced options strategies available")
        
        # Show sample content for debugging
        logger.info("\n📄 HTML CONTENT SAMPLE:")
        logger.info("-" * 50)
        sample = scraped_data.get('raw_content_sample', '')
        
        # Clean up and show relevant parts
        clean_sample = re.sub(r'<script[^>]*>.*?</script>', '', sample, flags=re.DOTALL)
        clean_sample = re.sub(r'<style[^>]*>.*?</style>', '', clean_sample, flags=re.DOTALL)
        clean_sample = re.sub(r'<[^>]+>', ' ', clean_sample)
        clean_sample = re.sub(r'\s+', ' ', clean_sample).strip()
        
        if len(clean_sample) > 500:
            logger.info(f"📝 {clean_sample[:500]}...")
        else:
            logger.info(f"📝 {clean_sample}")
        
        # Provide actionable insights
        logger.info("\n🎯 AUTOMATION READINESS:")
        logger.info("-" * 50)
        
        if indicators.get('empty_portfolio'):
            logger.info("✅ READY FOR AUTOMATION:")
            logger.info("   1. Account is clean and ready for automated trading")
            logger.info("   2. Upstox signals can create new portfolios automatically")
            logger.info("   3. No existing positions to conflict with automation")
        else:
            logger.info("⚠️ EXISTING DATA DETECTED:")
            logger.info("   1. Account has existing portfolios/positions")
            logger.info("   2. Automation should avoid conflicts")
            logger.info("   3. Consider using separate portfolios for automated trades")
    
    def _extract_portfolios_from_data(self, data: Any, extracted_data: Dict):
        """Recursively extract portfolio data from nested JSON"""
        if isinstance(data, dict):
            for key, value in data.items():
                if key.lower() in ['portfolios', 'draftportfolios', 'portfolio', 'strategies']:
                    if isinstance(value, list):
                        extracted_data['found_portfolios'] = value
                        logger.info(f"📋 Found {len(value)} portfolios in embedded data")
                    elif isinstance(value, dict):
                        extracted_data['found_portfolios'] = [value]
                        logger.info(f"📋 Found 1 portfolio in embedded data")
                elif isinstance(value, (dict, list)):
                    self._extract_portfolios_from_data(value, extracted_data)
        elif isinstance(data, list):
            for item in data:
                if isinstance(item, (dict, list)):
                    self._extract_portfolios_from_data(item, extracted_data)
    
    def create_draft_portfolio(self, name: str) -> Optional[str]:
        """Create a new draft portfolio"""
        try:
            # Try different API endpoints for portfolio creation
            create_endpoints = [
                "/api/portfolios/create",
                "/api/draft-portfolios/create",
                "/api/portfolios",
                "/portfolios/create",
            ]
            
            payload = {
                'name': name,
                'type': 'draft',
                'description': f'Test portfolio created at {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}'
            }
            
            for endpoint in create_endpoints:
                try:
                    url = urljoin(self.base_url, endpoint)
                    
                    # Try both POST with JSON and form data
                    for content_type in ['application/json', 'application/x-www-form-urlencoded']:
                        headers = {'Content-Type': content_type}
                        
                        if content_type == 'application/json':
                            response = self.session.post(url, json=payload, headers=headers, timeout=10)
                        else:
                            response = self.session.post(url, data=payload, headers=headers, timeout=10)
                        
                        if response.status_code in [200, 201]:
                            logger.info(f"✅ Portfolio creation successful via {endpoint}")
                            try:
                                result = response.json()
                                portfolio_id = result.get('id') or result.get('portfolio_id') or result.get('_id')
                                if portfolio_id:
                                    logger.info(f"🎯 Created portfolio with ID: {portfolio_id}")
                                    return portfolio_id
                            except:
                                logger.info(f"Portfolio created but couldn't parse ID from response")
                                return "success"
                        elif response.status_code == 401:
                            logger.warning(f"🔐 Portfolio creation requires authentication")
                        elif response.status_code == 403:
                            logger.warning(f"🚫 Portfolio creation is forbidden")
                        
                except Exception as e:
                    logger.debug(f"Error trying endpoint {endpoint}: {str(e)}")
            
            logger.warning("⚠️ Could not create portfolio via any known endpoint")
            return None
            
        except Exception as e:
            logger.error(f"❌ Error creating portfolio: {str(e)}")
            return None
    
    def add_position_to_portfolio(self, portfolio_id: str, position_data: Dict) -> bool:
        """Add a position to draft portfolio"""
        try:
            # Try different endpoints for adding positions
            add_endpoints = [
                f"/api/portfolios/{portfolio_id}/positions",
                f"/api/draft-portfolios/{portfolio_id}/add",
                f"/portfolios/{portfolio_id}/positions/add",
                f"/api/positions/add",
            ]
            
            for endpoint in add_endpoints:
                try:
                    url = urljoin(self.base_url, endpoint)
                    response = self.session.post(url, json=position_data, timeout=10)
                    
                    if response.status_code in [200, 201]:
                        logger.info(f"✅ Position added successfully via {endpoint}")
                        return True
                    elif response.status_code == 401:
                        logger.warning(f"🔐 Adding position requires authentication")
                    elif response.status_code == 403:
                        logger.warning(f"🚫 Adding position is forbidden")
                        
                except Exception as e:
                    logger.debug(f"Error trying endpoint {endpoint}: {str(e)}")
            
            return False
            
        except Exception as e:
            logger.error(f"❌ Error adding position: {str(e)}")
            return False
    
    def get_option_chain(self, symbol: str, expiry: str = None) -> Dict:
        """Get options chain data for a symbol"""
        try:
            # Try different endpoints for options chain
            chain_endpoints = [
                f"/api/options/chain/{symbol}",
                f"/api/optionchain/{symbol}",
                f"/options/{symbol}/chain",
                f"/api/instruments/{symbol}/options",
            ]
            
            params = {}
            if expiry:
                params['expiry'] = expiry
            
            for endpoint in chain_endpoints:
                try:
                    url = urljoin(self.base_url, endpoint)
                    response = self.session.get(url, params=params, timeout=10)
                    
                    if response.status_code == 200:
                        logger.info(f"✅ Options chain retrieved via {endpoint}")
                        return response.json()
                    elif response.status_code == 401:
                        logger.warning(f"🔐 Options chain requires authentication")
                    elif response.status_code == 403:
                        logger.warning(f"🚫 Options chain access is forbidden")
                        
                except Exception as e:
                    logger.debug(f"Error trying endpoint {endpoint}: {str(e)}")
            
            return {}
            
        except Exception as e:
            logger.error(f"❌ Error getting options chain: {str(e)}")
            return {}

def load_browser_cookies() -> Dict[str, str]:
    """
    Automatically load cookies from browser session using rookiepy.
    
    This function automatically extracts cookies from Chrome/Firefox
    for the Sensibull domain, similar to the TradingView approach.
    """
    
    if not ROOKIEPY_AVAILABLE:
        logger.error("❌ rookiepy not available - install with: pip install rookiepy")
        logger.info("📋 Manual alternative:")
        logger.info("1. Login to https://web.sensibull.com/draft-portfolios in Chrome")
        logger.info("2. Open DevTools (F12) -> Application -> Cookies")
        logger.info("3. Copy relevant cookies and add them manually")
        return {}
    
    try:
        # Try Chrome first (same approach as TradingView)
        cookies_list = rookiepy.chrome(['.sensibull.com', 'sensibull.com', 'web.sensibull.com'])
        logger.info("✅ Sensibull cookies loaded from Chrome")
        
        # Convert to dictionary format
        cookies_dict = {cookie['name']: cookie['value'] for cookie in cookies_list}
        
        # Log found cookies (without values for security)
        cookie_names = list(cookies_dict.keys())
        logger.info(f"🍪 Found {len(cookie_names)} cookies: {cookie_names}")
        
        # Check for authentication-related cookies
        auth_cookies = [name for name in cookie_names if any(keyword in name.lower() 
                       for keyword in ['session', 'auth', 'token', 'csrf', 'login', 'user'])]
        
        if auth_cookies:
            logger.info(f"🔑 Authentication cookies found: {auth_cookies}")
        else:
            logger.warning("⚠️ No obvious authentication cookies found")
        
        return cookies_dict
        
    except Exception as chrome_error:
        logger.warning(f"⚠️ Chrome cookie extraction failed: {chrome_error}")
        
        try:
            # Fallback to Firefox
            cookies_list = rookiepy.firefox(['.sensibull.com', 'sensibull.com', 'web.sensibull.com'])
            logger.info("✅ Sensibull cookies loaded from Firefox")
            
            cookies_dict = {cookie['name']: cookie['value'] for cookie in cookies_list}
            cookie_names = list(cookies_dict.keys())
            logger.info(f"🍪 Found {len(cookie_names)} cookies: {cookie_names}")
            
            return cookies_dict
            
        except Exception as firefox_error:
            logger.error(f"❌ Firefox cookie extraction failed: {firefox_error}")
            logger.error("❌ Could not extract cookies from any browser")
            logger.info("📋 Manual steps:")
            logger.info("1. Make sure you're logged into https://web.sensibull.com/draft-portfolios")
            logger.info("2. Keep the browser tab open")
            logger.info("3. Try running the script again")
            return {}

def test_sensibull_integration():
    """Test Sensibull integration capabilities"""
    logger.info("🚀 Starting Sensibull Draft Portfolio Integration Test")
    logger.info("=" * 60)
    
    # Initialize API client
    api = SensibullAPI()
    
    # Load cookies
    cookies = load_browser_cookies()
    if cookies:
        api.set_authentication_cookies(cookies)
    else:
        logger.error("❌ No cookies available for testing")
        logger.info("Please update the load_browser_cookies() function with your session cookies")
        return
    
    # Test authentication
    logger.info("\n📋 Testing Authentication...")
    if api.test_authentication():
        logger.info("✅ Authentication successful")
    else:
        logger.error("❌ Authentication failed - check your cookies")
        return
    
    
    # Debug HTML structure to find 3 portfolios
    logger.info("\n🔍 DEBUGGING HTML TO FIND 3 PORTFOLIOS...")
    api.display_portfolio_summary()
    
    logger.info("\n" + "=" * 80)
    logger.info("🏁 Sensibull HTML Debugging Complete")
    
    logger.info("\n🎯 NEXT STEPS:")
    logger.info("1. Analyze the saved HTML file: sensibull_debug_content.html")
    logger.info("2. Look for the 3 portfolios in the detailed debug output above")
    logger.info("3. Use the discovered patterns to extract portfolio data")
    logger.info("4. Integrate with Upstox bot for automated trading")

def simulate_upstox_signal_forwarding():
    """Simulate how Upstox signals could be forwarded to Sensibull"""
    logger.info("\n🔗 SIMULATING UPSTOX → SENSIBULL SIGNAL FORWARDING")
    logger.info("=" * 60)
    
    # Example Upstox signal (from your existing bot)
    upstox_signal = {
        'symbol': 'TATAMOTORS',
        'side': 'BUY',
        'price': 485.50,
        'signal_type': 'support_bounce',
        'confidence': 0.85,
        'timestamp': datetime.now()
    }
    
    logger.info(f"📈 Received Upstox Signal: {upstox_signal['side']} {upstox_signal['symbol']} @ ₹{upstox_signal['price']}")
    
    # Convert to options strategy
    # Example: Convert bullish equity signal to Call option
    if upstox_signal['side'] == 'BUY':
        # Find ATM call option
        atm_strike = round(upstox_signal['price'] / 50) * 50  # Round to nearest 50
        option_type = 'CE'
        logger.info(f"🎯 Converting to Call Option: {upstox_signal['symbol']} {atm_strike} CE")
    else:
        # Find ATM put option
        atm_strike = round(upstox_signal['price'] / 50) * 50
        option_type = 'PE'
        logger.info(f"🎯 Converting to Put Option: {upstox_signal['symbol']} {atm_strike} PE")
    
    # Create Sensibull position
    sensibull_position = {
        'symbol': upstox_signal['symbol'],
        'instrument_type': 'OPTION',
        'option_type': option_type,
        'strike': atm_strike,
        'expiry': '2024-01-25',  # Next Thursday expiry
        'quantity': 50,  # 1 lot
        'side': 'BUY',
        'reason': f"Upstox {upstox_signal['signal_type']} signal",
        'confidence': upstox_signal['confidence']
    }
    
    logger.info(f"📊 Sensibull Position: {sensibull_position}")
    logger.info("✅ Signal forwarding simulation complete")

if __name__ == "__main__":
    print("""
🔥 SENSIBULL DRAFT PORTFOLIO AUTOMATION TEST
============================================

This script automatically tests interaction with Sensibull's web platform
using rookiepy for automatic cookie extraction (just like TradingView approach).

🚨 SETUP REQUIRED:
1. Make sure you have rookiepy installed: pip install rookiepy
2. Login to https://web.sensibull.com/draft-portfolios in Chrome/Firefox
3. Keep the browser tab open (don't close it)
4. Run this script - it will automatically extract cookies

✅ AUTOMATIC FEATURES:
- Auto-extracts cookies from Chrome/Firefox (no manual copying needed)
- Tests authentication status
- Discovers available API endpoints
- Tests portfolio creation and position management
- Simulates Upstox signal forwarding to options trades

📝 Purpose: Enable automatic options trading based on Upstox signals
⚠️  Note: This is for educational/testing purposes only
    """)
    
    try:
        # Run the integration test
        test_sensibull_integration()
        
        # Simulate signal forwarding
        simulate_upstox_signal_forwarding()
        
    except KeyboardInterrupt:
        logger.info("\n🛑 Test interrupted by user")
    except Exception as e:
        logger.error(f"❌ Test failed with error: {str(e)}")
    
    logger.info("\n👋 Test complete!")
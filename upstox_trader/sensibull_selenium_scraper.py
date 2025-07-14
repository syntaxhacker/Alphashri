#!/usr/bin/env python3
"""
Sensibull Portfolio Scraper using Selenium
==========================================

Since Sensibull is a Single Page Application (SPA), we need to use Selenium
to wait for JavaScript to load the portfolio data dynamically.

This script will:
1. Launch Chrome with your existing cookies
2. Navigate to draft portfolios page  
3. Wait for content to load
4. Extract the 3 portfolios and their details
"""

import time
import json
import logging
from datetime import datetime
from typing import Dict, List, Any
import re

# Selenium imports
try:
    from selenium import webdriver
    from selenium.webdriver.chrome.service import Service
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.common.action_chains import ActionChains
    SELENIUM_AVAILABLE = True
    print("✅ Selenium available for browser automation")
except ImportError:
    SELENIUM_AVAILABLE = False
    print("⚠️ Selenium not available - install with: pip install selenium")

# Cookie extraction
try:
    import rookiepy
    ROOKIEPY_AVAILABLE = True
    print("✅ rookiepy available for cookie extraction")
except ImportError:
    ROOKIEPY_AVAILABLE = False
    print("⚠️ rookiepy not available - install with: pip install rookiepy")

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('SensibullSelenium')

class SensibullSeleniumScraper:
    """Scrape Sensibull portfolios using Selenium browser automation"""
    
    def __init__(self):
        self.driver = None
        self.cookies = []
        self.base_url = "https://web.sensibull.com"
        
    def load_browser_cookies(self) -> bool:
        """Load cookies from browser using rookiepy"""
        if not ROOKIEPY_AVAILABLE:
            logger.error("❌ rookiepy not available")
            return False
        
        try:
            # Extract cookies from Chrome
            cookies_list = rookiepy.chrome(['.sensibull.com', 'sensibull.com', 'web.sensibull.com'])
            self.cookies = cookies_list
            logger.info(f"✅ Loaded {len(cookies_list)} cookies from Chrome")
            
            # Log authentication cookies
            auth_cookies = [c['name'] for c in cookies_list if any(keyword in c['name'].lower() 
                           for keyword in ['session', 'auth', 'token', 'csrf', 'login', 'user'])]
            if auth_cookies:
                logger.info(f"🔑 Authentication cookies: {auth_cookies}")
            
            return True
        except Exception as e:
            logger.error(f"❌ Error loading cookies: {str(e)}")
            return False
    
    def setup_chrome_driver(self) -> bool:
        """Setup Chrome driver with appropriate options"""
        if not SELENIUM_AVAILABLE:
            logger.error("❌ Selenium not available")
            return False
        
        try:
            # Chrome options
            chrome_options = Options()
            chrome_options.add_argument('--no-sandbox')
            chrome_options.add_argument('--disable-dev-shm-usage')
            chrome_options.add_argument('--disable-blink-features=AutomationControlled')
            chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
            chrome_options.add_experimental_option('useAutomationExtension', False)
            chrome_options.add_argument('--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
            
            # Disable images and CSS for faster loading (optional)
            # chrome_options.add_argument('--disable-images')
            
            # Initialize driver
            self.driver = webdriver.Chrome(options=chrome_options)
            
            # Execute script to hide automation indicators
            self.driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
            
            logger.info("✅ Chrome driver initialized successfully")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error setting up Chrome driver: {str(e)}")
            logger.info("💡 Make sure ChromeDriver is installed: brew install chromedriver")
            return False
    
    def navigate_and_inject_cookies(self) -> bool:
        """Navigate to Sensibull and inject cookies"""
        try:
            # First, navigate to the domain to set cookies
            logger.info("🌐 Navigating to Sensibull...")
            self.driver.get(self.base_url)
            
            # Wait a moment for page to load
            time.sleep(2)
            
            # Inject cookies
            logger.info("🍪 Injecting authentication cookies...")
            for cookie in self.cookies:
                try:
                    # Convert rookiepy cookie format to Selenium format
                    selenium_cookie = {
                        'name': cookie['name'],
                        'value': cookie['value'],
                        'domain': cookie.get('domain', '.sensibull.com'),
                        'path': cookie.get('path', '/'),
                        'secure': cookie.get('secure', True),
                        'httpOnly': cookie.get('httpOnly', False)
                    }
                    
                    # Add expiry if available
                    if 'expires' in cookie and cookie['expires']:
                        selenium_cookie['expiry'] = int(cookie['expires'])
                    
                    self.driver.add_cookie(selenium_cookie)
                except Exception as e:
                    logger.debug(f"⚠️ Skipping cookie {cookie['name']}: {str(e)}")
            
            logger.info("✅ Cookies injected successfully")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error navigating and injecting cookies: {str(e)}")
            return False
    
    def navigate_to_draft_portfolios(self) -> bool:
        """Navigate to draft portfolios page and wait for content"""
        try:
            # Navigate to draft portfolios
            draft_url = f"{self.base_url}/draft-portfolios"
            logger.info(f"📊 Navigating to: {draft_url}")
            self.driver.get(draft_url)
            
            # Wait for page to start loading
            time.sleep(3)
            
            # Wait for the loading screen to disappear and content to load
            logger.info("⏳ Waiting for content to load...")
            
            # Wait for the app div to have content (not just loading screen)
            wait = WebDriverWait(self.driver, 30)
            
            # Multiple strategies to detect loaded content
            content_loaded = False
            
            # Strategy 1: Wait for specific portfolio-related elements
            try:
                wait.until(lambda driver: len(driver.find_elements(By.TAG_NAME, "div")) > 10)
                logger.info("✅ Basic content structure loaded")
                content_loaded = True
            except:
                logger.info("⚠️ Basic content detection timeout")
            
            # Strategy 2: Wait for JavaScript to finish loading
            time.sleep(5)
            
            # Strategy 3: Check if we can find any text content
            body_text = self.driver.find_element(By.TAG_NAME, "body").text
            if len(body_text) > 100:
                logger.info(f"✅ Page content loaded ({len(body_text)} chars of text)")
                content_loaded = True
            
            # Strategy 4: Wait a bit more for dynamic content
            if not content_loaded:
                logger.info("⏳ Waiting additional time for dynamic content...")
                time.sleep(10)
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Error navigating to draft portfolios: {str(e)}")
            return False
    
    def extract_portfolio_data(self) -> Dict[str, Any]:
        """Extract portfolio data from the loaded page"""
        try:
            logger.info("🔍 EXTRACTING PORTFOLIO DATA FROM RENDERED PAGE")
            logger.info("=" * 60)
            
            # Get page source after JavaScript rendering
            page_source = self.driver.page_source
            logger.info(f"📄 Rendered page source: {len(page_source)} characters")
            
            # Save the rendered HTML for debugging
            with open('sensibull_rendered_content.html', 'w', encoding='utf-8') as f:
                f.write(page_source)
            logger.info("💾 Saved rendered HTML to: sensibull_rendered_content.html")
            
            # Get all visible text
            body_text = self.driver.find_element(By.TAG_NAME, "body").text
            logger.info(f"📝 Visible text: {len(body_text)} characters")
            
            if len(body_text) > 100:
                logger.info("📋 First 500 characters of visible text:")
                logger.info("-" * 40)
                logger.info(body_text[:500])
                logger.info("-" * 40)
            
            # Look for portfolio-related elements
            portfolio_data = {
                'portfolios': [],
                'total_elements': 0,
                'text_content': body_text,
                'source_length': len(page_source)
            }
            
            # Find all div elements that might contain portfolios
            all_divs = self.driver.find_elements(By.TAG_NAME, "div")
            portfolio_data['total_elements'] = len(all_divs)
            logger.info(f"📊 Found {len(all_divs)} div elements")
            
            # Look for elements with portfolio-related text
            portfolio_keywords = ['portfolio', 'strategy', 'position', 'pnl', 'profit', 'loss']
            potential_portfolio_elements = []
            
            for div in all_divs:
                try:
                    div_text = div.text.lower()
                    if any(keyword in div_text for keyword in portfolio_keywords):
                        if len(div_text) > 10:  # Filter out empty or very short elements
                            potential_portfolio_elements.append({
                                'element': div,
                                'text': div.text,
                                'tag_name': div.tag_name,
                                'class': div.get_attribute('class') or '',
                                'id': div.get_attribute('id') or ''
                            })
                except:
                    continue
            
            logger.info(f"🎯 Found {len(potential_portfolio_elements)} elements with portfolio keywords")
            
            # Analyze potential portfolio elements
            for i, elem_data in enumerate(potential_portfolio_elements[:10]):  # Show first 10
                logger.info(f"Element {i+1}:")
                logger.info(f"  Class: {elem_data['class']}")
                logger.info(f"  ID: {elem_data['id']}")
                logger.info(f"  Text: {elem_data['text'][:100]}...")
                logger.info("")
            
            # Look for specific patterns in the text
            logger.info("🔍 SEARCHING FOR SPECIFIC PATTERNS:")
            logger.info("-" * 40)
            
            # Portfolio names/titles
            portfolio_name_patterns = [
                r'(?i)portfolio\s*[:\-]?\s*([a-zA-Z0-9\s]+)',
                r'(?i)strategy\s*[:\-]?\s*([a-zA-Z0-9\s]+)',
                r'(?i)([a-zA-Z0-9\s]{5,30})\s*portfolio',
            ]
            
            # P&L patterns
            pnl_patterns = [
                r'(?i)(?:₹|rs\.?|inr)\s*([+-]?\d+(?:,\d+)*(?:\.\d+)?)',
                r'([+-]?\d+\.\d+)%',
                r'(?i)(?:profit|loss|pnl)\s*:?\s*([+-]?\d+(?:,\d+)*(?:\.\d+)?)',
            ]
            
            # Options patterns
            options_patterns = [
                r'(?i)(nifty|banknifty|sensex)\s+(\d+)\s+(ce|pe)',
                r'(?i)strike[:\s]*(\d+)',
                r'(?i)expiry[:\s]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})',
            ]
            
            found_patterns = {'portfolios': [], 'pnl': [], 'options': []}
            
            for pattern_type, patterns in [('portfolios', portfolio_name_patterns), ('pnl', pnl_patterns), ('options', options_patterns)]:
                for pattern in patterns:
                    matches = re.findall(pattern, body_text)
                    if matches:
                        found_patterns[pattern_type].extend(matches)
                        logger.info(f"✅ {pattern_type.title()} pattern: {matches[:5]}")
            
            portfolio_data['patterns'] = found_patterns
            
            # Try to find portfolio cards/sections by scrolling and looking
            logger.info("🔍 LOOKING FOR PORTFOLIO CARDS BY SCROLLING:")
            logger.info("-" * 40)
            
            # Scroll down to load any lazy-loaded content
            self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(2)
            
            # Scroll back up
            self.driver.execute_script("window.scrollTo(0, 0);")
            time.sleep(1)
            
            # Take a screenshot for debugging
            self.driver.save_screenshot('sensibull_screenshot.png')
            logger.info("📸 Saved screenshot to: sensibull_screenshot.png")
            
            return portfolio_data
            
        except Exception as e:
            logger.error(f"❌ Error extracting portfolio data: {str(e)}")
            import traceback
            logger.error(f"❌ Traceback: {traceback.format_exc()}")
            return {}
    
    def run_scraping_session(self) -> Dict[str, Any]:
        """Run complete scraping session"""
        try:
            logger.info("🚀 STARTING SENSIBULL SELENIUM SCRAPING SESSION")
            logger.info("=" * 60)
            
            # Step 1: Load cookies
            if not self.load_browser_cookies():
                return {"error": "Failed to load cookies"}
            
            # Step 2: Setup Chrome driver
            if not self.setup_chrome_driver():
                return {"error": "Failed to setup Chrome driver"}
            
            # Step 3: Navigate and inject cookies
            if not self.navigate_and_inject_cookies():
                return {"error": "Failed to navigate and inject cookies"}
            
            # Step 4: Navigate to draft portfolios
            if not self.navigate_to_draft_portfolios():
                return {"error": "Failed to navigate to draft portfolios"}
            
            # Step 5: Extract portfolio data
            portfolio_data = self.extract_portfolio_data()
            
            return portfolio_data
            
        except Exception as e:
            logger.error(f"❌ Error in scraping session: {str(e)}")
            return {"error": str(e)}
        
        finally:
            # Cleanup
            if self.driver:
                logger.info("🧹 Closing browser...")
                self.driver.quit()

def main():
    """Main function to run the Selenium scraper"""
    print("""
🔥 SENSIBULL SELENIUM PORTFOLIO SCRAPER
========================================

This script uses Selenium to:
1. Load your Chrome cookies automatically
2. Launch a browser session
3. Navigate to Sensibull draft portfolios
4. Wait for JavaScript to load content
5. Extract your 3 portfolios and their details

Requirements:
- Chrome browser installed
- ChromeDriver installed (brew install chromedriver)
- You must be logged into Sensibull in Chrome

Starting scraper...
    """)
    
    if not SELENIUM_AVAILABLE:
        print("❌ Error: Selenium not installed")
        print("Install with: pip install selenium")
        return
    
    if not ROOKIEPY_AVAILABLE:
        print("❌ Error: rookiepy not installed") 
        print("Install with: pip install rookiepy")
        return
    
    # Run the scraper
    scraper = SensibullSeleniumScraper()
    result = scraper.run_scraping_session()
    
    # Display results
    print("\n" + "=" * 60)
    print("🏁 SCRAPING RESULTS")
    print("=" * 60)
    
    if "error" in result:
        print(f"❌ Error: {result['error']}")
    else:
        print(f"✅ Successfully scraped portfolio data")
        print(f"📊 Total elements found: {result.get('total_elements', 0)}")
        print(f"📄 Source length: {result.get('source_length', 0)} chars")
        print(f"📝 Text content: {len(result.get('text_content', ''))} chars")
        
        patterns = result.get('patterns', {})
        for pattern_type, matches in patterns.items():
            if matches:
                print(f"🎯 {pattern_type.title()}: {len(matches)} matches found")
        
        print(f"\n📋 Check these files for detailed analysis:")
        print(f"   - sensibull_rendered_content.html (full HTML)")
        print(f"   - sensibull_screenshot.png (visual)")

if __name__ == "__main__":
    main()
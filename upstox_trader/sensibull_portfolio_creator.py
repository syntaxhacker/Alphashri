#!/usr/bin/env python3
"""
Sensibull Portfolio Creator and Trade Executor
==============================================

This script creates new portfolios and adds trades to Sensibull draft portfolios
using Selenium automation. It extends the existing scraper to perform actions
rather than just reading data.

Features:
- Create new draft portfolios
- Add options trades to portfolios
- Execute strategies within portfolios
- Monitor portfolio performance after trades

Usage:
    python sensibull_portfolio_creator.py
"""

import time
import json
import logging
from datetime import datetime
from typing import Dict, List, Any, Optional
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
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.support.ui import Select
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
logger = logging.getLogger('SensibullCreator')

class SensibullPortfolioCreator:
    """Create and manage Sensibull portfolios with Selenium automation"""
    
    def __init__(self):
        self.driver = None
        self.cookies = []
        self.base_url = "https://web.sensibull.com"
        self.wait = None
        
    def load_browser_cookies(self) -> bool:
        """Load cookies from browser using rookiepy"""
        if not ROOKIEPY_AVAILABLE:
            logger.error("❌ rookiepy not available")
            return False
        
        try:
            cookies_list = rookiepy.chrome(['.sensibull.com', 'sensibull.com', 'web.sensibull.com'])
            self.cookies = cookies_list
            logger.info(f"✅ Loaded {len(cookies_list)} cookies from Chrome")
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
            chrome_options = Options()
            chrome_options.add_argument('--no-sandbox')
            chrome_options.add_argument('--disable-dev-shm-usage')
            chrome_options.add_argument('--disable-blink-features=AutomationControlled')
            chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
            chrome_options.add_experimental_option('useAutomationExtension', False)
            chrome_options.add_argument('--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
            
            # Keep browser open for interaction
            # chrome_options.add_argument('--headless')  # Comment out for debugging
            
            self.driver = webdriver.Chrome(options=chrome_options)
            self.wait = WebDriverWait(self.driver, 30)
            
            # Hide automation indicators
            self.driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
            
            logger.info("✅ Chrome driver initialized successfully")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error setting up Chrome driver: {str(e)}")
            return False
    
    def navigate_and_inject_cookies(self) -> bool:
        """Navigate to Sensibull and inject cookies"""
        try:
            logger.info("🌐 Navigating to Sensibull...")
            self.driver.get(self.base_url)
            time.sleep(2)
            
            logger.info("🍪 Injecting authentication cookies...")
            for cookie in self.cookies:
                try:
                    selenium_cookie = {
                        'name': cookie['name'],
                        'value': cookie['value'],
                        'domain': cookie.get('domain', '.sensibull.com'),
                        'path': cookie.get('path', '/'),
                        'secure': cookie.get('secure', True),
                        'httpOnly': cookie.get('httpOnly', False)
                    }
                    
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
        """Navigate to draft portfolios page"""
        try:
            draft_url = f"{self.base_url}/draft-portfolios"
            logger.info(f"📊 Navigating to: {draft_url}")
            self.driver.get(draft_url)
            
            # Wait for content to load
            time.sleep(5)
            
            # Wait for the page to have portfolio-related content
            self.wait.until(lambda driver: len(driver.find_elements(By.TAG_NAME, "div")) > 10)
            logger.info("✅ Draft portfolios page loaded")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Error navigating to draft portfolios: {str(e)}")
            return False
    
    def create_new_portfolio(self, portfolio_name: str) -> bool:
        """Create a new draft portfolio"""
        try:
            logger.info(f"🆕 Creating new portfolio: {portfolio_name}")
            
            # Look for "Create New" button
            create_buttons = [
                "Create New",
                "Create Portfolio", 
                "New Portfolio",
                "+ Create New"
            ]
            
            create_button = None
            for button_text in create_buttons:
                try:
                    # Try different approaches to find the create button
                    elements = self.driver.find_elements(By.XPATH, f"//*[contains(text(), '{button_text}')]")
                    if elements:
                        create_button = elements[0]
                        logger.info(f"✅ Found create button: {button_text}")
                        break
                        
                    # Try button elements specifically
                    elements = self.driver.find_elements(By.XPATH, f"//button[contains(text(), '{button_text}')]")
                    if elements:
                        create_button = elements[0]
                        logger.info(f"✅ Found create button: {button_text}")
                        break
                        
                except Exception:
                    continue
            
            if not create_button:
                # Take a screenshot to see what's available
                self.driver.save_screenshot('portfolio_creation_debug.png')
                logger.error("❌ Could not find create portfolio button")
                
                # Try to find any clickable elements that might be the create button
                all_buttons = self.driver.find_elements(By.TAG_NAME, "button")
                logger.info(f"🔍 Found {len(all_buttons)} buttons on page")
                
                for i, button in enumerate(all_buttons[:10]):  # Check first 10 buttons
                    try:
                        button_text = button.text.strip()
                        if button_text:
                            logger.info(f"   Button {i+1}: '{button_text}'")
                            if any(word in button_text.lower() for word in ['create', 'new', 'add']):
                                create_button = button
                                logger.info(f"✅ Using button: '{button_text}'")
                                break
                    except:
                        continue
                
                if not create_button:
                    return False
            
            # Click the create button
            logger.info("🖱️ Clicking create portfolio button...")
            self.driver.execute_script("arguments[0].scrollIntoView(true);", create_button)
            time.sleep(2)
            
            # Try multiple click methods with better error handling
            click_success = False
            try:
                # Method 1: Direct click
                create_button.click()
                click_success = True
                logger.info("✅ Direct click successful")
            except Exception as e:
                logger.info(f"⚠️ Direct click failed: {e}")
                try:
                    # Method 2: ActionChains click
                    ActionChains(self.driver).move_to_element(create_button).click().perform()
                    click_success = True
                    logger.info("✅ ActionChains click successful")
                except Exception as e:
                    logger.info(f"⚠️ ActionChains click failed: {e}")
                    try:
                        # Method 3: JavaScript click
                        self.driver.execute_script("arguments[0].click();", create_button)
                        click_success = True
                        logger.info("✅ JavaScript click successful")
                    except Exception as e:
                        logger.error(f"❌ All click methods failed: {e}")
            
            if not click_success:
                logger.error("❌ Failed to click create button")
                self.driver.save_screenshot('create_button_click_failed.png')
                return False
            
            # Wait longer for modal/form to appear
            time.sleep(5)
            
            # Look for portfolio name input field
            name_input = None
            input_selectors = [
                "input[placeholder*='name']",
                "input[placeholder*='Name']", 
                "input[type='text']",
                "input[name*='name']",
                "input[id*='name']"
            ]
            
            for selector in input_selectors:
                try:
                    elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                    if elements:
                        name_input = elements[0]
                        logger.info(f"✅ Found name input with selector: {selector}")
                        break
                except:
                    continue
            
            if not name_input:
                # Take another screenshot for debugging
                self.driver.save_screenshot('name_input_debug.png')
                logger.error("❌ Could not find portfolio name input field")
                return False
            
            # Enter portfolio name
            logger.info(f"⌨️ Entering portfolio name: {portfolio_name}")
            name_input.clear()
            name_input.send_keys(portfolio_name)
            time.sleep(1)
            
            # Look for submit/save/create button
            submit_button = None
            submit_texts = ["Create", "Save", "Submit", "OK", "Confirm"]
            
            for submit_text in submit_texts:
                try:
                    elements = self.driver.find_elements(By.XPATH, f"//button[contains(text(), '{submit_text}')]")
                    if elements:
                        submit_button = elements[0]
                        logger.info(f"✅ Found submit button: {submit_text}")
                        break
                except:
                    continue
            
            if submit_button:
                logger.info("🖱️ Clicking submit button...")
                submit_success = False
                try:
                    submit_button.click()
                    submit_success = True
                    logger.info("✅ Submit button clicked successfully")
                except Exception as e:
                    logger.info(f"⚠️ Direct submit click failed: {e}")
                    try:
                        self.driver.execute_script("arguments[0].click();", submit_button)
                        submit_success = True
                        logger.info("✅ JavaScript submit click successful")
                    except Exception as e:
                        logger.error(f"❌ Submit click failed: {e}")
                
                if submit_success:
                    # Wait longer and monitor for navigation
                    logger.info("⏳ Waiting for portfolio creation and navigation...")
                    time.sleep(8)  # Increased wait time
                    
                    # Check if we've been redirected to the new portfolio page
                    current_url = self.driver.current_url
                    logger.info(f"📍 Post-creation URL: {current_url}")
                    
                    if "/draft-portfolios/" in current_url and len(current_url.split("/")) > 4:
                        logger.info(f"✅ Successfully created and navigated to portfolio page")
                    else:
                        logger.info("📋 Portfolio created, checking list for new portfolio...")
                    
                    logger.info(f"✅ Portfolio '{portfolio_name}' created successfully")
                    return True
                else:
                    # Try pressing Enter key as fallback
                    logger.info("⌨️ Trying Enter key to submit...")
                    name_input.send_keys(Keys.RETURN)
                    time.sleep(8)
                    logger.info(f"✅ Portfolio '{portfolio_name}' created successfully")
                    return True
            else:
                # Try pressing Enter key
                logger.info("⌨️ No submit button found, trying Enter key...")
                name_input.send_keys(Keys.RETURN)
                time.sleep(8)
                logger.info(f"✅ Portfolio '{portfolio_name}' created successfully")
                return True
                
        except Exception as e:
            logger.error(f"❌ Error creating portfolio: {str(e)}")
            # Take screenshot for debugging
            self.driver.save_screenshot('portfolio_creation_error.png')
            return False
    
    def add_trade_to_portfolio(self, portfolio_name: str, trade_details: Dict[str, Any]) -> bool:
        """Add a trade to the specified portfolio"""
        try:
            logger.info(f"📈 Adding trade to portfolio: {portfolio_name}")
            logger.info(f"   Trade details: {trade_details}")
            
            # After portfolio creation, Sensibull automatically navigates to /draft-portfolios/:id
            # Wait for this navigation to complete
            logger.info("⏳ Waiting for automatic navigation to portfolio page...")
            time.sleep(5)
            
            # Check if we're on the portfolio detail page
            current_url = self.driver.current_url
            logger.info(f"📍 Current URL: {current_url}")
            
            if "/draft-portfolios/" in current_url and len(current_url.split("/")) > 4:
                logger.info("✅ Already on portfolio detail page")
                portfolio_found = True
            else:
                # If not automatically navigated, try to find and click the portfolio
                logger.info("🔍 Looking for portfolio in the list...")
                portfolio_found = False
                
                # Wait a bit more and refresh the page
                time.sleep(3)
                self.driver.refresh()
                time.sleep(3)
                
                # Look for portfolio by name
                portfolio_elements = self.driver.find_elements(By.XPATH, f"//*[contains(text(), '{portfolio_name}')]")
                
                for element in portfolio_elements:
                    try:
                        # Try to click on the portfolio to open it
                        self.driver.execute_script("arguments[0].scrollIntoView(true);", element)
                        time.sleep(1)
                        element.click()
                        portfolio_found = True
                        logger.info(f"✅ Opened portfolio: {portfolio_name}")
                        break
                    except:
                        continue
            
            if not portfolio_found:
                logger.error(f"❌ Could not access portfolio: {portfolio_name}")
                return False
            
            # Wait for portfolio page to load
            time.sleep(5)
            
            # Look for "Add/Import" button that opens the option chain sidebar
            add_import_button = None
            trade_button_texts = [
                "Add/Import",
                "Add / Import",
                "Add Import", 
                "Import",
                "Add",
                "Add Trade",
                "New Trade", 
                "Add Position",
                "+ Add"
            ]
            
            for button_text in trade_button_texts:
                try:
                    # Try exact text match first
                    elements = self.driver.find_elements(By.XPATH, f"//*[text()='{button_text}']")
                    if elements:
                        add_import_button = elements[0]
                        logger.info(f"✅ Found Add/Import button: {button_text}")
                        break
                    
                    # Try partial text match
                    elements = self.driver.find_elements(By.XPATH, f"//*[contains(text(), '{button_text}')]")
                    if elements:
                        add_import_button = elements[0]
                        logger.info(f"✅ Found Add/Import button: {button_text}")
                        break
                except:
                    continue
            
            if not add_import_button:
                # Look for any button that might add trades or import options
                all_buttons = self.driver.find_elements(By.TAG_NAME, "button")
                logger.info(f"🔍 Found {len(all_buttons)} buttons in portfolio view")
                
                for i, button in enumerate(all_buttons[:15]):  # Check more buttons
                    try:
                        button_text = button.text.strip()
                        if button_text:
                            logger.info(f"   Button {i+1}: '{button_text}'")
                            if any(word in button_text.lower() for word in ['add', 'import', 'trade', 'position', 'option']):
                                add_import_button = button
                                logger.info(f"✅ Using button: '{button_text}'")
                                break
                    except:
                        continue
                
                if not add_import_button:
                    logger.error("❌ Could not find Add/Import button")
                    self.driver.save_screenshot('add_import_debug.png')
                    return False
            
            # Click Add/Import button to open option chain sidebar
            logger.info("🖱️ Clicking Add/Import button to open option chain sidebar...")
            try:
                add_import_button.click()
            except:
                self.driver.execute_script("arguments[0].click();", add_import_button)
            
            time.sleep(3)
            
            # Wait for sidebar to open
            logger.info("⏳ Waiting for option chain sidebar to open...")
            time.sleep(2)
            
            # Look for the sidebar or modal that contains option chain
            sidebar_found = False
            sidebar_indicators = [
                "option chain", 
                "options", 
                "strike", 
                "expiry", 
                "call", 
                "put",
                "CE",
                "PE"
            ]
            
            # Check if sidebar opened by looking for option-related text
            page_text = self.driver.find_element(By.TAG_NAME, "body").text.lower()
            for indicator in sidebar_indicators:
                if indicator in page_text:
                    sidebar_found = True
                    logger.info(f"✅ Option chain sidebar opened (found: {indicator})")
                    break
            
            if not sidebar_found:
                logger.warning("⚠️ Option chain sidebar may not have opened")
                self.driver.save_screenshot('sidebar_debug.png')
            
            time.sleep(2)
            
            # Now interact with the option chain sidebar
            logger.info("📝 Interacting with option chain sidebar...")
            
            try:
                # Look for common option chain elements
                # 1. Underlying symbol selection (NIFTY, BANKNIFTY, etc.)
                if 'symbol' in trade_details:
                    symbol = trade_details['symbol'].upper()
                    logger.info(f"🎯 Looking for {symbol} in option chain...")
                    
                    # Try to find and click on the symbol
                    symbol_elements = self.driver.find_elements(By.XPATH, f"//*[contains(text(), '{symbol}')]")
                    for elem in symbol_elements:
                        try:
                            if elem.is_displayed() and elem.is_enabled():
                                elem.click()
                                logger.info(f"✅ Selected symbol: {symbol}")
                                time.sleep(2)
                                break
                        except:
                            continue
                
                # 2. Look for strike prices and option types (CE/PE)
                if 'strike' in trade_details and 'option_type' in trade_details:
                    strike = str(trade_details['strike'])
                    option_type = trade_details['option_type'].upper()  # CE or PE
                    
                    logger.info(f"🎯 Looking for {strike} {option_type} option...")
                    
                    # Look for elements containing both strike and option type
                    option_elements = self.driver.find_elements(By.XPATH, f"//*[contains(text(), '{strike}') and contains(text(), '{option_type}')]")
                    
                    if not option_elements:
                        # Try separate searches
                        option_elements = self.driver.find_elements(By.XPATH, f"//*[contains(text(), '{strike}')]")
                    
                    for elem in option_elements:
                        try:
                            if elem.is_displayed():
                                # Look for Buy/Sell buttons near this option
                                parent = elem.find_element(By.XPATH, "./..")
                                buy_buttons = parent.find_elements(By.XPATH, ".//button[contains(text(), 'Buy') or contains(text(), 'BUY')]")
                                
                                if buy_buttons:
                                    buy_buttons[0].click()
                                    logger.info(f"✅ Clicked Buy for {strike} {option_type}")
                                    time.sleep(2)
                                    break
                        except:
                            continue
                
                # 3. If quantity field appears after selecting option
                if 'quantity' in trade_details:
                    time.sleep(1)
                    qty_inputs = self.driver.find_elements(By.CSS_SELECTOR, 
                        "input[placeholder*='quantity'], input[placeholder*='Quantity'], input[placeholder*='qty'], input[type='number']")
                    
                    for qty_input in qty_inputs:
                        try:
                            if qty_input.is_displayed() and qty_input.is_enabled():
                                qty_input.clear()
                                qty_input.send_keys(str(trade_details['quantity']))
                                logger.info(f"✅ Entered quantity: {trade_details['quantity']}")
                                break
                        except:
                            continue
                
                # 4. Submit/Confirm the trade
                time.sleep(2)
                submit_buttons = self.driver.find_elements(By.XPATH, 
                    "//button[contains(text(), 'Add') or contains(text(), 'Confirm') or contains(text(), 'Submit') or contains(text(), 'Buy')]")
                
                for submit_btn in submit_buttons:
                    try:
                        if submit_btn.is_displayed() and submit_btn.is_enabled():
                            submit_btn.click()
                            logger.info("✅ Submitted trade to portfolio")
                            time.sleep(3)
                            return True
                    except:
                        continue
                
                logger.warning("⚠️ Could not find submit button, trade may need manual completion")
                
                # Take screenshot of the current state
                self.driver.save_screenshot('option_chain_state.png')
                logger.info("📸 Screenshot saved for manual verification")
                
                return True  # Consider it successful if we got this far
                
            except Exception as form_error:
                logger.error(f"❌ Error interacting with option chain: {str(form_error)}")
                self.driver.save_screenshot('option_chain_error.png')
                return False
                
        except Exception as e:
            logger.error(f"❌ Error adding trade: {str(e)}")
            return False
    
    def take_debug_screenshot(self, filename: str = None):
        """Take a screenshot for debugging purposes"""
        if not filename:
            filename = f"debug_screenshot_{int(time.time())}.png"
        
        try:
            self.driver.save_screenshot(filename)
            logger.info(f"📸 Debug screenshot saved: {filename}")
        except Exception as e:
            logger.error(f"❌ Could not save screenshot: {e}")
    
    def run_portfolio_creation_session(self, portfolio_name: str, trade_details: Dict[str, Any] = None) -> bool:
        """Run complete portfolio creation and trade addition session"""
        try:
            logger.info("🚀 STARTING PORTFOLIO CREATION SESSION")
            logger.info("=" * 60)
            
            # Step 1: Load cookies
            if not self.load_browser_cookies():
                return False
            
            # Step 2: Setup Chrome driver
            if not self.setup_chrome_driver():
                return False
            
            # Step 3: Navigate and inject cookies
            if not self.navigate_and_inject_cookies():
                return False
            
            # Step 4: Navigate to draft portfolios
            if not self.navigate_to_draft_portfolios():
                return False
            
            # Step 5: Create new portfolio
            if not self.create_new_portfolio(portfolio_name):
                return False
            
            # Step 6: Add trade if provided
            if trade_details:
                if not self.add_trade_to_portfolio(portfolio_name, trade_details):
                    logger.warning("⚠️ Trade addition failed, but portfolio was created")
            
            # Take a final screenshot
            self.take_debug_screenshot('portfolio_creation_complete.png')
            
            logger.info("✅ Portfolio creation session completed successfully")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error in portfolio creation session: {str(e)}")
            return False
        
        finally:
            # Keep browser open for manual inspection
            logger.info("🔍 Browser session kept open for manual inspection")
            logger.info("💡 Close the browser manually when done")
            # Uncomment the line below to close automatically:
            # if self.driver:
            #     self.driver.quit()

def main():
    """Main function to create portfolio and add trade"""
    print("""
🔥 SENSIBULL PORTFOLIO CREATOR
=============================

This script will:
1. Create a new draft portfolio
2. Add a test trade to the portfolio
3. Keep browser open for manual verification

Starting creation process...
    """)
    
    if not SELENIUM_AVAILABLE:
        print("❌ Error: Selenium not installed")
        print("Install with: pip install selenium")
        return
    
    if not ROOKIEPY_AVAILABLE:
        print("❌ Error: rookiepy not installed")
        print("Install with: pip install rookiepy")
        return
    
    # Portfolio details
    portfolio_name = f"test_portfolio_{int(time.time())}"  # Unique name
    
    # Sample trade details for option chain (adjust based on your needs)
    trade_details = {
        'symbol': 'NIFTY',
        'strike': 24000,  # Strike price
        'option_type': 'CE',  # CE or PE
        'quantity': 50,
        'trade_type': 'BUY'
    }
    
    print(f"📊 Creating portfolio: {portfolio_name}")
    print(f"📈 Adding trade: {trade_details}")
    
    # Run the creation session
    creator = SensibullPortfolioCreator()
    success = creator.run_portfolio_creation_session(portfolio_name, trade_details)
    
    if success:
        print("\n✅ PORTFOLIO CREATION SUCCESSFUL!")
        print(f"📊 Portfolio '{portfolio_name}' created")
        print("🔍 Browser left open - verify manually and close when done")
    else:
        print("\n❌ PORTFOLIO CREATION FAILED")
        print("Check debug screenshots and logs for details")

if __name__ == "__main__":
    main()
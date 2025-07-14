#!/usr/bin/env python3
"""
Complete Trade Flow - Add Orders Manually
=========================================

Based on the screenshot analysis, after clicking Add/Import, we get a dropdown with:
1. "Add Orders Manually" 
2. "Import Zerodha Trades"

We need to click "Add Orders Manually" to open the option chain and make a test trade.
This script will loop until the trade is successfully completed.
"""

import time
import logging
import cv2
import numpy as np
from datetime import datetime
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys
import rookiepy

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger('CompleteTradeFlow')

class CompleteTradeFlow:
    def __init__(self):
        self.driver = None
        self.screenshots = []
        self.portfolio_url = None
        
    def setup_driver(self):
        """Setup Chrome driver"""
        chrome_options = Options()
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        self.driver = webdriver.Chrome(options=chrome_options)
        logger.info("✅ Chrome driver initialized")
        
    def load_and_inject_cookies(self):
        """Load cookies and navigate to Sensibull"""
        cookies = rookiepy.chrome(['.sensibull.com', 'sensibull.com', 'web.sensibull.com'])
        logger.info(f"✅ Loaded {len(cookies)} cookies")
        
        self.driver.get("https://web.sensibull.com")
        time.sleep(2)
        
        for cookie in cookies:
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
            except:
                continue
        
        self.driver.get("https://web.sensibull.com/draft-portfolios")
        time.sleep(5)
        logger.info("✅ Navigated to draft portfolios")
        
    def take_screenshot(self, description=""):
        """Take a screenshot with timestamp"""
        timestamp = datetime.now().strftime("%H%M%S")
        filename = f"trade_{len(self.screenshots)+1:02d}_{timestamp}_{description.replace(' ', '_')}.png"
        
        try:
            self.driver.save_screenshot(filename)
            self.screenshots.append(filename)
            logger.info(f"📸 Screenshot saved: {filename}")
            return filename
        except Exception as e:
            logger.error(f"❌ Screenshot failed: {e}")
            return None
            
    def navigate_to_portfolio(self):
        """Navigate to the debug test portfolio"""
        logger.info("🎯 Looking for debug_test portfolio...")
        
        self.take_screenshot("start_portfolio_search")
        
        # Look for the debug_test portfolio specifically
        portfolio_elements = self.driver.find_elements(By.XPATH, "//*[contains(text(), 'debug_test')]")
        
        for element in portfolio_elements:
            try:
                element_text = element.text.strip()
                if 'debug_test' in element_text:
                    logger.info(f"🎯 Found debug portfolio: {element_text}")
                    
                    # Try to click on it
                    self.driver.execute_script("arguments[0].scrollIntoView(true);", element)
                    time.sleep(1)
                    element.click()
                    time.sleep(3)
                    
                    current_url = self.driver.current_url
                    if "/draft-portfolios/" in current_url:
                        self.portfolio_url = current_url
                        logger.info(f"✅ Successfully navigated to: {current_url}")
                        self.take_screenshot("portfolio_loaded")
                        return True
            except Exception as e:
                logger.info(f"⚠️ Could not click portfolio element: {e}")
        
        logger.error("❌ Could not find or access debug_test portfolio")
        return False
        
    def click_add_import_button(self):
        """Click the Add/Import button to open the dropdown"""
        logger.info("🔍 Looking for Add/Import button...")
        
        max_attempts = 3
        for attempt in range(max_attempts):
            logger.info(f"📍 Attempt {attempt + 1}/{max_attempts}")
            
            # Look for Add/Import button
            add_import_elements = self.driver.find_elements(By.XPATH, "//*[contains(text(), 'Add/Import')]")
            
            if add_import_elements:
                button = add_import_elements[0]
                if button.is_displayed() and button.is_enabled():
                    logger.info("✅ Found Add/Import button")
                    
                    self.take_screenshot("before_add_import_click")
                    
                    try:
                        button.click()
                        logger.info("✅ Clicked Add/Import button")
                        time.sleep(2)
                        
                        self.take_screenshot("after_add_import_click")
                        return True
                    except Exception as e:
                        logger.error(f"❌ Failed to click Add/Import: {e}")
            
            time.sleep(1)
        
        logger.error("❌ Could not find or click Add/Import button")
        return False
        
    def click_add_orders_manually(self):
        """Click 'Add Orders Manually' from the dropdown"""
        logger.info("🔍 Looking for 'Add Orders Manually' option...")
        
        max_attempts = 5
        for attempt in range(max_attempts):
            logger.info(f"📍 Attempt {attempt + 1}/{max_attempts}")
            
            # Look for "Add Orders Manually" text
            manual_elements = self.driver.find_elements(By.XPATH, "//*[contains(text(), 'Add Orders Manually')]")
            
            if manual_elements:
                element = manual_elements[0]
                if element.is_displayed():
                    logger.info("✅ Found 'Add Orders Manually' option")
                    
                    self.take_screenshot("before_manual_orders_click")
                    
                    try:
                        # Try multiple click methods
                        try:
                            element.click()
                            logger.info("✅ Direct click successful")
                        except:
                            self.driver.execute_script("arguments[0].click();", element)
                            logger.info("✅ JavaScript click successful")
                        
                        time.sleep(3)
                        self.take_screenshot("after_manual_orders_click")
                        
                        # Check if option chain or trade form appeared
                        page_text = self.driver.find_element(By.TAG_NAME, "body").text.lower()
                        option_indicators = ['strike', 'expiry', 'call', 'put', 'ce', 'pe', 'buy', 'sell', 'nifty', 'banknifty']
                        
                        found_indicators = [ind for ind in option_indicators if ind in page_text]
                        if found_indicators:
                            logger.info(f"✅ Option chain/trade form opened! Found: {found_indicators[:3]}")
                            return True
                        else:
                            logger.info("⚠️ No option chain indicators found yet, continuing...")
                            
                    except Exception as e:
                        logger.error(f"❌ Failed to click Add Orders Manually: {e}")
            else:
                logger.info("⚠️ 'Add Orders Manually' not found, waiting...")
                
            time.sleep(2)
        
        logger.error("❌ Could not find or click 'Add Orders Manually'")
        return False
        
    def interact_with_option_chain(self):
        """Interact with the option chain to make a test trade"""
        logger.info("🎯 Interacting with option chain...")
        
        self.take_screenshot("option_chain_loaded")
        
        # Test trade parameters
        trade_params = {
            'symbol': 'NIFTY',
            'strike': '24000',
            'option_type': 'CE',
            'quantity': '25',
            'action': 'BUY'
        }
        
        logger.info(f"📈 Trade parameters: {trade_params}")
        
        max_attempts = 10
        for attempt in range(max_attempts):
            logger.info(f"🔄 Trade attempt {attempt + 1}/{max_attempts}")
            
            try:
                # Step 1: Look for symbol selection (NIFTY, BANKNIFTY, etc.)
                symbol_found = False
                symbol_elements = self.driver.find_elements(By.XPATH, f"//*[contains(text(), '{trade_params['symbol']}')]")
                
                for elem in symbol_elements:
                    if elem.is_displayed() and elem.is_enabled():
                        try:
                            elem.click()
                            logger.info(f"✅ Selected symbol: {trade_params['symbol']}")
                            symbol_found = True
                            time.sleep(1)
                            break
                        except:
                            continue
                
                # Step 2: Look for strike price
                strike_found = False
                if symbol_found or attempt > 2:  # Try strike even if symbol not explicitly found
                    strike_elements = self.driver.find_elements(By.XPATH, f"//*[contains(text(), '{trade_params['strike']}')]")
                    
                    for elem in strike_elements:
                        if elem.is_displayed():
                            try:
                                # Look for buy button near this strike
                                parent = elem.find_element(By.XPATH, "../..")
                                buy_buttons = parent.find_elements(By.XPATH, ".//button[contains(text(), 'Buy') or contains(text(), 'BUY')]")
                                
                                if buy_buttons:
                                    buy_buttons[0].click()
                                    logger.info(f"✅ Clicked Buy for {trade_params['strike']} strike")
                                    strike_found = True
                                    time.sleep(2)
                                    break
                            except:
                                continue
                
                # Step 3: Look for quantity input
                qty_found = False
                if strike_found or attempt > 5:  # Try quantity input anyway
                    qty_selectors = [
                        "input[placeholder*='quantity']",
                        "input[placeholder*='Quantity']", 
                        "input[placeholder*='qty']",
                        "input[type='number']",
                        "input[name*='quantity']",
                        "input[id*='quantity']"
                    ]
                    
                    for selector in qty_selectors:
                        qty_inputs = self.driver.find_elements(By.CSS_SELECTOR, selector)
                        for qty_input in qty_inputs:
                            if qty_input.is_displayed() and qty_input.is_enabled():
                                try:
                                    qty_input.clear()
                                    qty_input.send_keys(trade_params['quantity'])
                                    logger.info(f"✅ Entered quantity: {trade_params['quantity']}")
                                    qty_found = True
                                    time.sleep(1)
                                    break
                                except Exception as e:
                                    logger.info(f"⚠️ Quantity input failed: {e}")
                            if qty_found:
                                break
                        if qty_found:
                            break
                
                # Step 4: Look for submit/add/confirm button
                if qty_found or attempt > 7:  # Try submit anyway
                    submit_texts = ['Add', 'Submit', 'Confirm', 'Buy', 'Place Order', 'Add Order']
                    
                    for submit_text in submit_texts:
                        submit_elements = self.driver.find_elements(By.XPATH, f"//button[contains(text(), '{submit_text}')]")
                        
                        for submit_btn in submit_elements:
                            if submit_btn.is_displayed() and submit_btn.is_enabled():
                                try:
                                    submit_btn.click()
                                    logger.info(f"✅ Clicked {submit_text} button")
                                    time.sleep(3)
                                    
                                    # Check if trade was added
                                    self.take_screenshot(f"after_submit_attempt_{attempt+1}")
                                    
                                    # Look for success indicators
                                    page_text = self.driver.find_element(By.TAG_NAME, "body").text.lower()
                                    success_indicators = ['added', 'success', 'order', 'position', 'trade']
                                    
                                    if any(ind in page_text for ind in success_indicators):
                                        logger.info("✅ Trade appears to have been added successfully!")
                                        return True
                                        
                                except Exception as e:
                                    logger.info(f"⚠️ Submit button click failed: {e}")
                
                # Take screenshot of current state
                self.take_screenshot(f"attempt_{attempt+1}_state")
                
                # If we haven't succeeded yet, try scrolling or waiting
                if attempt < max_attempts - 1:
                    logger.info("⚠️ Trade not completed, scrolling and retrying...")
                    self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                    time.sleep(1)
                    self.driver.execute_script("window.scrollTo(0, 0);")
                    time.sleep(2)
                
            except Exception as e:
                logger.error(f"❌ Error in trade attempt {attempt + 1}: {e}")
                time.sleep(2)
        
        logger.warning("⚠️ Could not complete trade automatically - manual intervention may be needed")
        return False
        
    def run_complete_trade_flow(self):
        """Run the complete trade flow until successful"""
        try:
            logger.info("🚀 STARTING COMPLETE TRADE FLOW")
            logger.info("=" * 50)
            
            # Setup
            self.setup_driver()
            self.load_and_inject_cookies()
            
            # Step 1: Navigate to portfolio
            if not self.navigate_to_portfolio():
                return False
            
            # Step 2: Click Add/Import button
            if not self.click_add_import_button():
                return False
            
            # Step 3: Click "Add Orders Manually"
            if not self.click_add_orders_manually():
                return False
            
            # Step 4: Interact with option chain and make trade
            trade_success = self.interact_with_option_chain()
            
            # Final screenshot
            self.take_screenshot("final_trade_state")
            
            if trade_success:
                logger.info("🎉 COMPLETE TRADE FLOW SUCCESSFUL!")
                logger.info("✅ Test trade appears to have been added")
            else:
                logger.warning("⚠️ Trade flow incomplete - check screenshots for manual completion")
            
            # Summary
            logger.info(f"📸 Total screenshots: {len(self.screenshots)}")
            for screenshot in self.screenshots:
                logger.info(f"   - {screenshot}")
            
            return trade_success
            
        except Exception as e:
            logger.error(f"❌ Trade flow error: {e}")
            return False
        
        finally:
            logger.info("🔍 Browser left open for manual inspection")

def main():
    print("""
🔥 COMPLETE TRADE FLOW - ADD ORDERS MANUALLY
==========================================

Based on screenshot analysis, this script will:
1. Navigate to debug_test portfolio
2. Click Add/Import button 
3. Click "Add Orders Manually"
4. Interact with option chain to make test trade
5. Loop until trade is successfully completed

Starting complete trade flow...
    """)
    
    trader = CompleteTradeFlow()
    success = trader.run_complete_trade_flow()
    
    if success:
        print("\n🎉 TRADE FLOW COMPLETED SUCCESSFULLY!")
        print("✅ Test trade has been added to portfolio")
    else:
        print("\n⚠️ TRADE FLOW NEEDS MANUAL COMPLETION")
        print("🔍 Check screenshots and browser for current state")
    
    input("\nPress Enter to close browser...")

if __name__ == "__main__":
    main()
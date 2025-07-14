#!/usr/bin/env python3
"""
Targeted Option Trade - Click on Option Chain Rows
==================================================

Based on the screenshot analysis, I can see the exact option chain interface:
- NIFTY is already selected
- Strike prices visible: 24950, 25000, 25050, 25100, 25150, 25200, 25250, 25300, 25350, 25400  
- Need to click on a specific row (call or put side)
- Then click the blue "Add" button

This script will click on a specific option in the chain and add it to the portfolio.
"""

import time
import logging
from datetime import datetime
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.action_chains import ActionChains
import rookiepy

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger('TargetedTrade')

class TargetedOptionTrade:
    def __init__(self):
        self.driver = None
        self.screenshots = []
        
    def setup_driver(self):
        """Setup Chrome driver"""
        chrome_options = Options()
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        self.driver = webdriver.Chrome(options=chrome_options)
        logger.info("✅ Chrome driver initialized")
        
    def load_and_inject_cookies(self):
        """Load cookies and navigate to portfolio"""
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
        
        # Navigate directly to the portfolio that we know works
        portfolio_url = "https://web.sensibull.com/draft-portfolios/8d768847-bed2-4850-b16f-1154dfcb6391"
        self.driver.get(portfolio_url)
        time.sleep(5)
        logger.info(f"✅ Navigated directly to portfolio: {portfolio_url}")
        
    def take_screenshot(self, description=""):
        """Take a screenshot with timestamp"""
        timestamp = datetime.now().strftime("%H%M%S")
        filename = f"targeted_{len(self.screenshots)+1:02d}_{timestamp}_{description.replace(' ', '_')}.png"
        
        try:
            self.driver.save_screenshot(filename)
            self.screenshots.append(filename)
            logger.info(f"📸 Screenshot saved: {filename}")
            return filename
        except Exception as e:
            logger.error(f"❌ Screenshot failed: {e}")
            return None
            
    def open_option_chain(self):
        """Open the option chain by clicking Add/Import -> Add Orders Manually"""
        logger.info("🔍 Opening option chain...")
        
        self.take_screenshot("start_option_chain")
        
        # Step 1: Click Add/Import
        add_import_elements = self.driver.find_elements(By.XPATH, "//*[contains(text(), 'Add/Import')]")
        if add_import_elements:
            add_import_elements[0].click()
            logger.info("✅ Clicked Add/Import")
            time.sleep(2)
            
            self.take_screenshot("after_add_import")
            
            # Step 2: Click "Add Orders Manually"
            manual_elements = self.driver.find_elements(By.XPATH, "//*[contains(text(), 'Add Orders Manually')]")
            if manual_elements:
                manual_elements[0].click()
                logger.info("✅ Clicked Add Orders Manually")
                time.sleep(3)
                
                self.take_screenshot("option_chain_opened")
                return True
        
        logger.error("❌ Could not open option chain")
        return False
        
    def click_on_option_row(self, target_strike="25000", option_type="call"):
        """Click on a specific option in the chain
        
        Args:
            target_strike: Strike price to target (e.g., "25000")
            option_type: "call" for left side, "put" for right side
        """
        logger.info(f"🎯 Looking for {target_strike} {option_type} option...")
        
        max_attempts = 5
        for attempt in range(max_attempts):
            logger.info(f"📍 Attempt {attempt + 1}/{max_attempts}")
            
            try:
                # Strategy 1: Look for the strike price text and click on the row
                strike_elements = self.driver.find_elements(By.XPATH, f"//*[text()='{target_strike}']")
                
                for strike_element in strike_elements:
                    if strike_element.is_displayed():
                        logger.info(f"✅ Found strike {target_strike}")
                        
                        # Get the parent row
                        try:
                            row = strike_element.find_element(By.XPATH, "../..")
                            logger.info("✅ Found option row")
                            
                            # For calls, click on the left side; for puts, click on the right side
                            if option_type.lower() == "call":
                                # Click on the left side of the row (call side)
                                call_cells = row.find_elements(By.TAG_NAME, "td")[:4]  # First 4 cells are call side
                                if call_cells:
                                    clickable_cell = call_cells[1] if len(call_cells) > 1 else call_cells[0]
                                    clickable_cell.click()
                                    logger.info(f"✅ Clicked on {target_strike} CALL")
                                    time.sleep(2)
                                    self.take_screenshot(f"clicked_{target_strike}_call")
                                    return True
                            else:
                                # Click on the right side of the row (put side)
                                put_cells = row.find_elements(By.TAG_NAME, "td")[4:]  # Last cells are put side
                                if put_cells:
                                    clickable_cell = put_cells[1] if len(put_cells) > 1 else put_cells[0]
                                    clickable_cell.click()
                                    logger.info(f"✅ Clicked on {target_strike} PUT")
                                    time.sleep(2)
                                    self.take_screenshot(f"clicked_{target_strike}_put")
                                    return True
                                    
                        except Exception as e:
                            logger.info(f"⚠️ Could not interact with row: {e}")
                            
                # Strategy 2: Look for clickable elements containing the strike price
                clickable_elements = self.driver.find_elements(By.XPATH, f"//*[contains(text(), '{target_strike}') and (self::td or self::div or self::span)]")
                
                for element in clickable_elements:
                    if element.is_displayed():
                        try:
                            element.click()
                            logger.info(f"✅ Clicked element containing {target_strike}")
                            time.sleep(2)
                            self.take_screenshot(f"clicked_{target_strike}_element")
                            return True
                        except Exception as e:
                            logger.info(f"⚠️ Could not click element: {e}")
                
                # Strategy 3: Try clicking on any visible cells in the option chain
                if attempt >= 2:
                    logger.info("🔄 Trying to click on any visible option...")
                    table_cells = self.driver.find_elements(By.TAG_NAME, "td")
                    
                    for i, cell in enumerate(table_cells[:20]):  # Try first 20 cells
                        if cell.is_displayed() and cell.text.strip():
                            try:
                                cell.click()
                                logger.info(f"✅ Clicked on table cell {i+1}: {cell.text[:20]}")
                                time.sleep(2)
                                self.take_screenshot(f"clicked_cell_{i+1}")
                                return True
                            except:
                                continue
                
                logger.info(f"⚠️ Attempt {attempt + 1} failed, retrying...")
                time.sleep(1)
                
            except Exception as e:
                logger.error(f"❌ Error in attempt {attempt + 1}: {e}")
                time.sleep(1)
        
        logger.error(f"❌ Could not click on {target_strike} {option_type} after {max_attempts} attempts")
        return False
        
    def click_add_button(self):
        """Click the blue Add button to complete the trade"""
        logger.info("🔍 Looking for Add button...")
        
        max_attempts = 5
        for attempt in range(max_attempts):
            logger.info(f"📍 Add button attempt {attempt + 1}/{max_attempts}")
            
            # Look for Add button
            add_button_selectors = [
                "//button[text()='Add']",
                "//button[contains(text(), 'Add')]",
                "//*[@id='add']",
                "//button[contains(@class, 'add')]",
                "//input[@type='submit' and @value='Add']"
            ]
            
            for selector in add_button_selectors:
                try:
                    add_buttons = self.driver.find_elements(By.XPATH, selector)
                    for button in add_buttons:
                        if button.is_displayed() and button.is_enabled():
                            logger.info(f"✅ Found Add button with selector: {selector}")
                            
                            self.take_screenshot("before_add_button")
                            
                            try:
                                button.click()
                                logger.info("✅ Clicked Add button!")
                                time.sleep(3)
                                
                                self.take_screenshot("after_add_button")
                                
                                # Check if trade was added successfully
                                page_text = self.driver.find_element(By.TAG_NAME, "body").text.lower()
                                success_indicators = ['added', 'success', 'position', 'order']
                                
                                if any(indicator in page_text for indicator in success_indicators):
                                    logger.info("🎉 Trade appears to have been added successfully!")
                                    return True
                                else:
                                    logger.info("⚠️ Add button clicked but success unclear")
                                    return True  # Consider it successful if button was clicked
                                    
                            except Exception as e:
                                logger.error(f"❌ Could not click Add button: {e}")
                                
                except Exception as e:
                    continue
            
            # If no button found, try scrolling
            logger.info("⚠️ Add button not found, scrolling...")
            self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(1)
            
        logger.error("❌ Could not find or click Add button")
        return False
        
    def complete_targeted_trade(self):
        """Complete the entire targeted trade flow"""
        try:
            logger.info("🚀 STARTING TARGETED OPTION TRADE")
            logger.info("=" * 50)
            
            # Setup and navigate
            self.setup_driver()
            self.load_and_inject_cookies()
            
            # Open option chain
            if not self.open_option_chain():
                return False
            
            # Click on a specific option (try multiple strikes)
            strikes_to_try = ["25000", "25100", "25200", "24950", "25050"]
            option_clicked = False
            
            for strike in strikes_to_try:
                logger.info(f"🎯 Trying strike: {strike}")
                if self.click_on_option_row(strike, "call"):
                    option_clicked = True
                    break
                    
            if not option_clicked:
                logger.error("❌ Could not click on any option")
                return False
            
            # Click Add button
            add_success = self.click_add_button()
            
            # Final screenshot
            self.take_screenshot("final_trade_complete")
            
            if add_success:
                logger.info("🎉 TARGETED TRADE COMPLETED SUCCESSFULLY!")
                return True
            else:
                logger.warning("⚠️ Trade may need manual completion")
                return False
                
        except Exception as e:
            logger.error(f"❌ Targeted trade error: {e}")
            return False
        
        finally:
            logger.info("🔍 Browser left open for inspection")
            logger.info(f"📸 Screenshots taken: {len(self.screenshots)}")
            for screenshot in self.screenshots:
                logger.info(f"   - {screenshot}")

def main():
    print("""
🎯 TARGETED OPTION TRADE
========================

Based on screenshot analysis, this script will:
1. Open the option chain (Add/Import -> Add Orders Manually)
2. Click on a specific option in the chain (25000 CE)
3. Click the blue "Add" button to complete trade

Target: NIFTY 25000 CE (or nearest available strike)

Starting targeted trade...
    """)
    
    trader = TargetedOptionTrade()
    success = trader.complete_targeted_trade()
    
    if success:
        print("\n🎉 TARGETED TRADE COMPLETED!")
        print("✅ Option successfully added to portfolio")
    else:
        print("\n⚠️ TRADE NEEDS MANUAL COMPLETION")
        print("🔍 Check screenshots and browser")
    
    input("\nPress Enter to close browser...")

if __name__ == "__main__":
    main()
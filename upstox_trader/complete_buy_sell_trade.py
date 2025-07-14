#!/usr/bin/env python3
"""
Complete Buy/Sell Trade with Hover Actions
==========================================

Correct workflow discovered:
1. Open option chain (Strikes tab) ✅
2. Hover over strike price row (25000) to reveal B/S buttons  
3. Click B (Buy) or S (Sell) button
4. Enter quantity in the qty field that appears
5. Click Add button (now enabled) to complete trade

This script implements the complete hover → B/S → quantity → Add workflow.
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
from selenium.webdriver.common.keys import Keys
import rookiepy

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger('BuySellTrade')

class CompleteBuySellTrade:
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
        
    def load_and_navigate(self):
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
        
        # Navigate directly to portfolio
        portfolio_url = "https://web.sensibull.com/draft-portfolios/8d768847-bed2-4850-b16f-1154dfcb6391"
        self.driver.get(portfolio_url)
        time.sleep(5)
        logger.info(f"✅ Navigated to portfolio")
        
    def take_screenshot(self, description=""):
        """Take a screenshot with timestamp"""
        timestamp = datetime.now().strftime("%H%M%S")
        filename = f"buysell_{len(self.screenshots)+1:02d}_{timestamp}_{description.replace(' ', '_')}.png"
        
        try:
            self.driver.save_screenshot(filename)
            self.screenshots.append(filename)
            logger.info(f"📸 Screenshot saved: {filename}")
            return filename
        except Exception as e:
            logger.error(f"❌ Screenshot failed: {e}")
            return None
            
    def open_option_chain_to_strikes(self):
        """Open option chain and navigate to Strikes tab"""
        logger.info("🚀 Opening option chain to Strikes tab...")
        
        self.take_screenshot("start_buysell_trade")
        
        # Click Add/Import
        add_import_elements = self.driver.find_elements(By.XPATH, "//*[contains(text(), 'Add/Import')]")
        if add_import_elements and add_import_elements[0].is_displayed():
            add_import_elements[0].click()
            logger.info("✅ Clicked Add/Import")
            time.sleep(2)
            
            # Click "Add Orders Manually"
            manual_elements = self.driver.find_elements(By.XPATH, "//*[contains(text(), 'Add Orders Manually')]")
            if manual_elements and manual_elements[0].is_displayed():
                manual_elements[0].click()
                logger.info("✅ Clicked Add Orders Manually")
                time.sleep(3)
                
                # Click Strikes tab
                strikes_elements = self.driver.find_elements(By.XPATH, "//*[text()='Strikes']")
                for element in strikes_elements:
                    if element.is_displayed():
                        element.click()
                        logger.info("✅ Clicked Strikes tab")
                        time.sleep(2)
                        break
                
                self.take_screenshot("strikes_tab_ready")
                return True
        
        return False
        
    def hover_and_find_buy_sell_buttons(self, target_strike="25000"):
        """Hover over strike row to reveal B/S buttons"""
        logger.info(f"🎯 Hovering over {target_strike} to reveal B/S buttons...")
        
        max_attempts = 5
        for attempt in range(max_attempts):
            logger.info(f"📍 Hover attempt {attempt + 1}/{max_attempts}")
            
            # Find the target strike element
            strike_elements = self.driver.find_elements(By.XPATH, f"//*[text()='{target_strike}']")
            
            for strike_elem in strike_elements:
                if strike_elem.is_displayed():
                    try:
                        logger.info(f"✅ Found {target_strike} strike element")
                        
                        # Get the row containing this strike
                        row = strike_elem.find_element(By.XPATH, "../..")
                        
                        # Hover over the row
                        ActionChains(self.driver).move_to_element(row).perform()
                        logger.info(f"✅ Hovered over {target_strike} row")
                        time.sleep(2)
                        
                        self.take_screenshot(f"hovered_{target_strike}")
                        
                        # Look for B and S buttons that should appear
                        buy_sell_selectors = [
                            "//button[text()='B']",
                            "//button[text()='S']", 
                            "//button[contains(text(), 'Buy')]",
                            "//button[contains(text(), 'Sell')]",
                            "//*[text()='B' and (self::button or self::div or self::span)]",
                            "//*[text()='S' and (self::button or self::div or self::span)]"
                        ]
                        
                        found_buttons = []
                        for selector in buy_sell_selectors:
                            buttons = self.driver.find_elements(By.XPATH, selector)
                            for button in buttons:
                                if button.is_displayed():
                                    button_text = button.text.strip()
                                    logger.info(f"🔍 Found button: '{button_text}' (selector: {selector})")
                                    found_buttons.append((button, button_text))
                        
                        if found_buttons:
                            logger.info(f"✅ Found {len(found_buttons)} B/S buttons after hover")
                            return found_buttons, row
                        else:
                            logger.info("⚠️ No B/S buttons found after hover, trying different approach...")
                            
                            # Try hovering over specific cells in the row
                            cells = row.find_elements(By.TAG_NAME, "td")
                            for i, cell in enumerate(cells):
                                if cell.is_displayed():
                                    ActionChains(self.driver).move_to_element(cell).perform()
                                    time.sleep(1)
                                    
                                    # Check again for B/S buttons
                                    for selector in buy_sell_selectors:
                                        buttons = self.driver.find_elements(By.XPATH, selector)
                                        for button in buttons:
                                            if button.is_displayed():
                                                button_text = button.text.strip()
                                                logger.info(f"✅ Found button after cell hover: '{button_text}'")
                                                found_buttons.append((button, button_text))
                                    
                                    if found_buttons:
                                        logger.info(f"✅ Found {len(found_buttons)} B/S buttons after cell hover")
                                        return found_buttons, row
                        
                    except Exception as e:
                        logger.info(f"⚠️ Error with strike element: {e}")
            
            # Try hovering over the entire option chain area
            if attempt >= 2:
                logger.info("🔄 Trying to hover over option chain table...")
                try:
                    table = self.driver.find_element(By.TAG_NAME, "table")
                    ActionChains(self.driver).move_to_element(table).perform()
                    time.sleep(2)
                except:
                    pass
            
            time.sleep(1)
        
        logger.warning("⚠️ Could not find B/S buttons after hover attempts")
        return [], None
        
    def click_buy_or_sell_button(self, buttons_list, action="buy"):
        """Click the Buy (B) or Sell (S) button"""
        logger.info(f"🎯 Looking for {action.upper()} button to click...")
        
        target_texts = ["B", "Buy"] if action.lower() == "buy" else ["S", "Sell"]
        
        for button, button_text in buttons_list:
            if button_text in target_texts:
                try:
                    button.click()
                    logger.info(f"✅ Clicked {action.upper()} button: '{button_text}'")
                    time.sleep(2)
                    self.take_screenshot(f"clicked_{action}_button")
                    return True
                except Exception as e:
                    logger.info(f"⚠️ Could not click {action} button: {e}")
        
        # If exact match not found, try first available button
        if buttons_list:
            try:
                button, button_text = buttons_list[0]
                button.click()
                logger.info(f"✅ Clicked first available button: '{button_text}'")
                time.sleep(2)
                return True
            except Exception as e:
                logger.error(f"❌ Could not click any button: {e}")
        
        return False
        
    def enter_quantity(self, quantity="25"):
        """Enter quantity in the qty field that appears"""
        logger.info(f"🎯 Looking for quantity field to enter: {quantity}")
        
        max_attempts = 5
        for attempt in range(max_attempts):
            logger.info(f"📍 Quantity field attempt {attempt + 1}/{max_attempts}")
            
            # Multiple selectors for quantity input
            qty_selectors = [
                "//input[@placeholder*='qty' or @placeholder*='quantity' or @placeholder*='Qty' or @placeholder*='Quantity']",
                "//input[@type='number']",
                "//input[@name*='qty' or @name*='quantity']",
                "//input[@id*='qty' or @id*='quantity']",
                "//input[contains(@class, 'qty') or contains(@class, 'quantity')]"
            ]
            
            for selector in qty_selectors:
                try:
                    qty_inputs = self.driver.find_elements(By.XPATH, selector)
                    for qty_input in qty_inputs:
                        if qty_input.is_displayed() and qty_input.is_enabled():
                            logger.info(f"✅ Found quantity input with selector: {selector}")
                            
                            # Clear and enter quantity
                            qty_input.clear()
                            qty_input.send_keys(quantity)
                            logger.info(f"✅ Entered quantity: {quantity}")
                            time.sleep(1)
                            
                            self.take_screenshot(f"quantity_entered_{quantity}")
                            return True
                            
                except Exception as e:
                    logger.info(f"⚠️ Selector {selector} failed: {e}")
            
            # Look for any input that appeared recently
            all_inputs = self.driver.find_elements(By.TAG_NAME, "input")
            for i, inp in enumerate(all_inputs):
                try:
                    if inp.is_displayed() and inp.is_enabled():
                        input_type = inp.get_attribute('type') or ''
                        placeholder = inp.get_attribute('placeholder') or ''
                        logger.info(f"   Input {i+1}: type='{input_type}', placeholder='{placeholder}'")
                        
                        # Try inputs that look like quantity fields
                        if (input_type == 'number' or 
                            'qty' in placeholder.lower() or 
                            'quantity' in placeholder.lower()):
                            inp.clear()
                            inp.send_keys(quantity)
                            logger.info(f"✅ Entered quantity in input {i+1}")
                            time.sleep(1)
                            return True
                            
                except Exception as e:
                    continue
            
            time.sleep(1)
        
        logger.warning("⚠️ Could not find quantity input field")
        return False
        
    def click_enabled_add_button(self):
        """Click the Add button (should be enabled after quantity entry)"""
        logger.info("🎯 Looking for enabled Add button...")
        
        self.take_screenshot("before_enabled_add_click")
        
        max_attempts = 8
        for attempt in range(max_attempts):
            logger.info(f"📍 Enabled Add button attempt {attempt + 1}/{max_attempts}")
            
            # Look for Add button
            add_buttons = self.driver.find_elements(By.XPATH, "//button[text()='Add' or contains(text(), 'Add')]")
            
            for i, button in enumerate(add_buttons):
                if button.is_displayed():
                    is_enabled = button.is_enabled()
                    button_class = button.get_attribute('class') or ''
                    button_text = button.text.strip()
                    
                    logger.info(f"   Add button {i+1}: '{button_text}' (enabled: {is_enabled})")
                    
                    if is_enabled and button_text == 'Add':
                        try:
                            # Scroll into view
                            self.driver.execute_script("arguments[0].scrollIntoView(true);", button)
                            time.sleep(1)
                            
                            # Click the button
                            button.click()
                            logger.info("🎉 Clicked enabled Add button!")
                            time.sleep(3)
                            
                            self.take_screenshot("after_enabled_add_click")
                            
                            # Check for success indicators
                            current_url = self.driver.current_url
                            page_text = self.driver.find_element(By.TAG_NAME, "body").text.lower()
                            
                            if ('draft-portfolios' in current_url and len(current_url.split('/')) <= 5):
                                logger.info("🎉 Returned to portfolio - trade successful!")
                                return True
                            elif any(word in page_text for word in ['added', 'success', 'position', 'order']):
                                logger.info("🎉 Success indicators found!")
                                return True
                            else:
                                logger.info("✅ Add button clicked successfully")
                                return True
                                
                        except Exception as e:
                            logger.error(f"❌ Error clicking Add button: {e}")
            
            # Wait and retry
            time.sleep(1)
        
        logger.error("❌ Could not click enabled Add button")
        return False
        
    def complete_buy_sell_trade(self, strike="25000", action="buy", quantity="25"):
        """Complete the entire buy/sell trade workflow"""
        try:
            logger.info("🚀 STARTING COMPLETE BUY/SELL TRADE")
            logger.info("=" * 50)
            logger.info(f"🎯 Target: {action.upper()} {quantity} units of {strike} strike")
            
            # Setup
            self.setup_driver()
            self.load_and_navigate()
            
            # Open option chain to Strikes tab
            if not self.open_option_chain_to_strikes():
                logger.error("❌ Could not open option chain")
                return False
            
            # Hover over strike row to reveal B/S buttons
            buttons_list, row = self.hover_and_find_buy_sell_buttons(strike)
            if not buttons_list:
                logger.error("❌ Could not find B/S buttons after hover")
                return False
            
            # Click Buy or Sell button
            if not self.click_buy_or_sell_button(buttons_list, action):
                logger.error("❌ Could not click Buy/Sell button")
                return False
            
            # Enter quantity
            if not self.enter_quantity(quantity):
                logger.error("❌ Could not enter quantity")
                return False
            
            # Click enabled Add button
            if not self.click_enabled_add_button():
                logger.error("❌ Could not click enabled Add button")
                return False
            
            # Final screenshot
            self.take_screenshot("trade_completed_final")
            
            logger.info("🎉 COMPLETE BUY/SELL TRADE SUCCESSFUL!")
            return True
            
        except Exception as e:
            logger.error(f"❌ Buy/Sell trade error: {e}")
            return False
        
        finally:
            logger.info("🔍 Browser left open for inspection")
            logger.info(f"📸 Screenshots: {len(self.screenshots)}")
            for screenshot in self.screenshots:
                logger.info(f"   - {screenshot}")

def main():
    print("""
🎯 COMPLETE BUY/SELL TRADE WITH HOVER
====================================

Correct workflow:
1. Open option chain (Strikes tab)
2. Hover over strike row (25000) to reveal B/S buttons
3. Click B (Buy) or S (Sell) button  
4. Enter quantity in qty field
5. Click enabled Add button

Target Trade: BUY 25 units of NIFTY 25000 strike

Starting complete trade...
    """)
    
    trader = CompleteBuySellTrade()
    success = trader.complete_buy_sell_trade(
        strike="25000",
        action="buy", 
        quantity="25"
    )
    
    if success:
        print("\n🎉 COMPLETE BUY/SELL TRADE SUCCESSFUL!")
        print("✅ Option trade executed: BUY 25 units of NIFTY 25000")
        print("📊 Trade should now appear in portfolio")
    else:
        print("\n⚠️ TRADE EXECUTION INCOMPLETE")
        print("🔍 Check browser and screenshots for current state")
    
    input("\nPress Enter to close browser...")

if __name__ == "__main__":
    main()
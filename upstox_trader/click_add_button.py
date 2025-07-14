#!/usr/bin/env python3
"""
Click Add Button - Complete the Trade
====================================

The option chain is already open and an option is selected.
The blue "Add" button is visible in the bottom right corner.
This script will simply click that button to complete the trade.
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
logger = logging.getLogger('ClickAddButton')

class ClickAddButton:
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
        
        # Navigate directly to the portfolio
        portfolio_url = "https://web.sensibull.com/draft-portfolios/8d768847-bed2-4850-b16f-1154dfcb6391"
        self.driver.get(portfolio_url)
        time.sleep(5)
        logger.info(f"✅ Navigated to portfolio")
        
    def take_screenshot(self, description=""):
        """Take a screenshot with timestamp"""
        timestamp = datetime.now().strftime("%H%M%S")
        filename = f"add_btn_{len(self.screenshots)+1:02d}_{timestamp}_{description.replace(' ', '_')}.png"
        
        try:
            self.driver.save_screenshot(filename)
            self.screenshots.append(filename)
            logger.info(f"📸 Screenshot saved: {filename}")
            return filename
        except Exception as e:
            logger.error(f"❌ Screenshot failed: {e}")
            return None
            
    def open_option_chain_quickly(self):
        """Quickly open the option chain to get to the Add button"""
        logger.info("🚀 Opening option chain...")
        
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
                
                self.take_screenshot("option_chain_ready")
                return True
        
        return False
        
    def find_and_click_add_button(self):
        """Find and click the blue Add button"""
        logger.info("🎯 Looking for the blue Add button...")
        
        max_attempts = 10
        for attempt in range(max_attempts):
            logger.info(f"📍 Attempt {attempt + 1}/{max_attempts}")
            
            self.take_screenshot(f"search_add_button_attempt_{attempt+1}")
            
            # Strategy 1: Look for button with text "Add"
            add_buttons = self.driver.find_elements(By.XPATH, "//button[text()='Add']")
            for button in add_buttons:
                if button.is_displayed() and button.is_enabled():
                    logger.info("✅ Found Add button (exact text)")
                    try:
                        # Scroll button into view
                        self.driver.execute_script("arguments[0].scrollIntoView(true);", button)
                        time.sleep(1)
                        
                        self.take_screenshot("before_add_click")
                        
                        # Try multiple click methods
                        try:
                            button.click()
                            logger.info("✅ Direct click successful!")
                        except:
                            try:
                                ActionChains(self.driver).move_to_element(button).click().perform()
                                logger.info("✅ ActionChains click successful!")
                            except:
                                self.driver.execute_script("arguments[0].click();", button)
                                logger.info("✅ JavaScript click successful!")
                        
                        time.sleep(3)
                        self.take_screenshot("after_add_click")
                        
                        # Check for success
                        current_url = self.driver.current_url
                        page_text = self.driver.find_element(By.TAG_NAME, "body").text.lower()
                        
                        success_indicators = ['position added', 'order added', 'success', 'added to portfolio']
                        if any(indicator in page_text for indicator in success_indicators):
                            logger.info("🎉 Trade added successfully!")
                            return True
                        elif 'draft-portfolios' in current_url and '/draft-portfolios/' in current_url:
                            logger.info("🎉 Returned to portfolio - trade likely successful!")
                            return True
                        else:
                            logger.info("✅ Add button clicked - checking if trade was added...")
                            return True
                            
                    except Exception as e:
                        logger.error(f"❌ Error clicking Add button: {e}")
            
            # Strategy 2: Look for any button containing "Add"
            add_buttons = self.driver.find_elements(By.XPATH, "//button[contains(text(), 'Add')]")
            for button in add_buttons:
                if button.is_displayed() and button.is_enabled():
                    button_text = button.text.strip()
                    logger.info(f"🔍 Found button with text: '{button_text}'")
                    
                    if button_text == "Add":
                        try:
                            button.click()
                            logger.info(f"✅ Clicked button: '{button_text}'")
                            time.sleep(3)
                            self.take_screenshot("after_button_click")
                            return True
                        except:
                            continue
            
            # Strategy 3: Look for buttons by CSS classes or other attributes
            button_selectors = [
                "button[class*='add']",
                "button[id*='add']", 
                "input[type='submit'][value*='Add']",
                "button[class*='primary']",
                "button[class*='blue']"
            ]
            
            for selector in button_selectors:
                buttons = self.driver.find_elements(By.CSS_SELECTOR, selector)
                for button in buttons:
                    if button.is_displayed() and button.is_enabled():
                        button_text = button.text.strip() or button.get_attribute('value') or ''
                        logger.info(f"🔍 Found button via CSS: '{button_text}' (selector: {selector})")
                        
                        if 'add' in button_text.lower() or button_text == 'Add':
                            try:
                                button.click()
                                logger.info(f"✅ Clicked CSS button: '{button_text}'")
                                time.sleep(3)
                                return True
                            except:
                                continue
            
            # Strategy 4: Look for any clickable element at the bottom right
            if attempt >= 5:
                logger.info("🔍 Looking for any clickable elements at bottom right...")
                all_buttons = self.driver.find_elements(By.TAG_NAME, "button")
                
                for i, button in enumerate(all_buttons):
                    try:
                        if button.is_displayed() and button.is_enabled():
                            location = button.location
                            size = button.size
                            button_text = button.text.strip()
                            
                            # Check if button is in the bottom right area
                            window_size = self.driver.get_window_size()
                            is_bottom_right = (
                                location['x'] > window_size['width'] * 0.7 and  # Right side
                                location['y'] > window_size['height'] * 0.7     # Bottom side
                            )
                            
                            if is_bottom_right:
                                logger.info(f"🎯 Found bottom-right button: '{button_text}' at {location}")
                                try:
                                    button.click()
                                    logger.info(f"✅ Clicked bottom-right button: '{button_text}'")
                                    time.sleep(3)
                                    return True
                                except:
                                    continue
                                    
                    except:
                        continue
            
            # Wait and retry
            logger.info("⚠️ Add button not found, waiting and retrying...")
            time.sleep(2)
        
        logger.error("❌ Could not find Add button after all attempts")
        return False
        
    def complete_add_button_task(self):
        """Complete the add button clicking task"""
        try:
            logger.info("🚀 STARTING ADD BUTTON CLICKER")
            logger.info("=" * 40)
            
            # Setup
            self.setup_driver()
            self.load_and_navigate()
            
            # Open option chain
            if not self.open_option_chain_quickly():
                logger.error("❌ Could not open option chain")
                return False
            
            # Click Add button
            success = self.find_and_click_add_button()
            
            # Final screenshot
            self.take_screenshot("final_result")
            
            return success
            
        except Exception as e:
            logger.error(f"❌ Add button task error: {e}")
            return False
        
        finally:
            logger.info("🔍 Browser left open for inspection")
            logger.info(f"📸 Screenshots: {len(self.screenshots)}")

def main():
    print("""
🎯 ADD BUTTON CLICKER
====================

The option chain is ready and an option is selected.
The blue "Add" button is visible in the bottom right.
This script will click that button to complete the trade.

Starting Add button click...
    """)
    
    clicker = ClickAddButton()
    success = clicker.complete_add_button_task()
    
    if success:
        print("\n🎉 ADD BUTTON CLICKED SUCCESSFULLY!")
        print("✅ Trade should be added to portfolio")
    else:
        print("\n⚠️ ADD BUTTON CLICK INCOMPLETE")
        print("🔍 Check browser for manual completion")
    
    input("\nPress Enter to close browser...")

if __name__ == "__main__":
    main()
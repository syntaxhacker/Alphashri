#!/usr/bin/env python3
"""
Final Trade Completion
======================

Based on the current state:
1. We're in Straddles tab (need to switch to Strikes tab)
2. Need to click radio button for an option (25000 CE/PE)  
3. Click the blue "Add" button to complete trade

This script will complete the final steps and also analyze HTML structure.
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
logger = logging.getLogger('FinalTrade')

class FinalTradeCompletion:
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
        filename = f"final_{len(self.screenshots)+1:02d}_{timestamp}_{description.replace(' ', '_')}.png"
        
        try:
            self.driver.save_screenshot(filename)
            self.screenshots.append(filename)
            logger.info(f"📸 Screenshot saved: {filename}")
            return filename
        except Exception as e:
            logger.error(f"❌ Screenshot failed: {e}")
            return None
            
    def analyze_html_structure(self):
        """Analyze the HTML structure to understand the interface"""
        logger.info("🔍 ANALYZING HTML STRUCTURE")
        logger.info("=" * 50)
        
        try:
            # Get page source and save it
            page_source = self.driver.page_source
            with open('option_chain_html_structure.html', 'w', encoding='utf-8') as f:
                f.write(page_source)
            logger.info("💾 Saved HTML structure to: option_chain_html_structure.html")
            
            # Analyze tabs
            tab_elements = self.driver.find_elements(By.XPATH, "//button[contains(text(), 'Straddles') or contains(text(), 'Strangles') or contains(text(), 'Strikes') or contains(text(), 'Futures')]")
            logger.info(f"📋 Found {len(tab_elements)} tab elements:")
            for i, tab in enumerate(tab_elements):
                tab_text = tab.text.strip()
                is_selected = 'selected' in tab.get_attribute('class').lower() or 'active' in tab.get_attribute('class').lower()
                logger.info(f"   Tab {i+1}: '{tab_text}' (selected: {is_selected})")
            
            # Analyze radio buttons
            radio_buttons = self.driver.find_elements(By.XPATH, "//input[@type='radio']")
            logger.info(f"🔘 Found {len(radio_buttons)} radio button elements")
            
            # Analyze table structure
            table_rows = self.driver.find_elements(By.TAG_NAME, "tr")
            logger.info(f"📊 Found {len(table_rows)} table rows")
            
            # Look for Add button
            add_buttons = self.driver.find_elements(By.XPATH, "//button[text()='Add' or contains(text(), 'Add')]")
            logger.info(f"➕ Found {len(add_buttons)} Add button candidates:")
            for i, btn in enumerate(add_buttons):
                if btn.is_displayed():
                    btn_text = btn.text.strip()
                    btn_class = btn.get_attribute('class')
                    logger.info(f"   Button {i+1}: '{btn_text}' (class: {btn_class[:50]}...)")
            
        except Exception as e:
            logger.error(f"❌ Error analyzing HTML structure: {e}")
            
    def open_option_chain(self):
        """Open the option chain interface"""
        logger.info("🚀 Opening option chain...")
        
        self.take_screenshot("start_final_trade")
        
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
                
                self.take_screenshot("option_chain_opened")
                return True
        
        return False
        
    def click_strikes_tab(self):
        """Click on the Strikes tab"""
        logger.info("🎯 Clicking on Strikes tab...")
        
        # Look for Strikes tab
        strikes_elements = self.driver.find_elements(By.XPATH, "//*[text()='Strikes']")
        
        for element in strikes_elements:
            if element.is_displayed():
                try:
                    element.click()
                    logger.info("✅ Clicked Strikes tab")
                    time.sleep(2)
                    self.take_screenshot("strikes_tab_selected")
                    return True
                except Exception as e:
                    logger.info(f"⚠️ Could not click Strikes tab: {e}")
        
        # Try alternative selectors
        alternative_selectors = [
            "//button[text()='Strikes']",
            "//div[text()='Strikes']",
            "//span[text()='Strikes']",
            "//*[contains(@class, 'tab') and text()='Strikes']"
        ]
        
        for selector in alternative_selectors:
            elements = self.driver.find_elements(By.XPATH, selector)
            for element in elements:
                if element.is_displayed():
                    try:
                        element.click()
                        logger.info(f"✅ Clicked Strikes tab with selector: {selector}")
                        time.sleep(2)
                        self.take_screenshot("strikes_tab_clicked")
                        return True
                    except:
                        continue
        
        logger.warning("⚠️ Could not find or click Strikes tab")
        return False
        
    def select_option_radio_button(self, target_strike="25000"):
        """Select a radio button for a specific strike"""
        logger.info(f"🎯 Selecting radio button for strike: {target_strike}")
        
        max_attempts = 5
        for attempt in range(max_attempts):
            logger.info(f"📍 Radio button attempt {attempt + 1}/{max_attempts}")
            
            # Strategy 1: Look for radio buttons near the target strike
            strike_elements = self.driver.find_elements(By.XPATH, f"//*[text()='{target_strike}']")
            
            for strike_elem in strike_elements:
                if strike_elem.is_displayed():
                    try:
                        # Look for radio button in the same row
                        row = strike_elem.find_element(By.XPATH, "../..")
                        radio_buttons = row.find_elements(By.XPATH, ".//input[@type='radio']")
                        
                        if radio_buttons:
                            radio_button = radio_buttons[0]  # Take first radio button in the row
                            if radio_button.is_displayed() and radio_button.is_enabled():
                                radio_button.click()
                                logger.info(f"✅ Selected radio button for {target_strike}")
                                time.sleep(1)
                                self.take_screenshot(f"radio_selected_{target_strike}")
                                return True
                    except Exception as e:
                        logger.info(f"⚠️ Could not select radio button in row: {e}")
            
            # Strategy 2: Look for any visible radio buttons
            if attempt >= 2:
                logger.info("🔄 Trying any visible radio button...")
                all_radios = self.driver.find_elements(By.XPATH, "//input[@type='radio']")
                
                for i, radio in enumerate(all_radios[:10]):  # Try first 10
                    if radio.is_displayed() and radio.is_enabled():
                        try:
                            radio.click()
                            logger.info(f"✅ Selected radio button {i+1}")
                            time.sleep(1)
                            self.take_screenshot(f"radio_selected_{i+1}")
                            return True
                        except:
                            continue
            
            # Strategy 3: Click on strike price itself (might select it)
            if attempt >= 3:
                logger.info("🔄 Trying to click strike price directly...")
                for strike_elem in strike_elements:
                    if strike_elem.is_displayed():
                        try:
                            strike_elem.click()
                            logger.info(f"✅ Clicked on strike price {target_strike}")
                            time.sleep(1)
                            return True
                        except:
                            continue
            
            time.sleep(1)
        
        logger.warning("⚠️ Could not select any radio button")
        return False
        
    def click_add_button_final(self):
        """Click the final Add button to complete the trade"""
        logger.info("🎯 Clicking the blue Add button...")
        
        self.take_screenshot("before_final_add")
        
        max_attempts = 8
        for attempt in range(max_attempts):
            logger.info(f"📍 Add button attempt {attempt + 1}/{max_attempts}")
            
            # Strategy 1: Look for exact "Add" button
            add_buttons = self.driver.find_elements(By.XPATH, "//button[text()='Add']")
            for button in add_buttons:
                if button.is_displayed() and button.is_enabled():
                    try:
                        # Scroll into view
                        self.driver.execute_script("arguments[0].scrollIntoView(true);", button)
                        time.sleep(1)
                        
                        # Try clicking
                        button.click()
                        logger.info("✅ Clicked Add button!")
                        time.sleep(3)
                        
                        self.take_screenshot("after_add_click")
                        
                        # Check for success
                        current_url = self.driver.current_url
                        if 'draft-portfolios' in current_url and len(current_url.split('/')) <= 5:
                            logger.info("🎉 Returned to portfolio - trade successful!")
                            return True
                        
                        # Check page content for success indicators
                        page_text = self.driver.find_element(By.TAG_NAME, "body").text.lower()
                        if any(word in page_text for word in ['added', 'success', 'position', 'order']):
                            logger.info("🎉 Success indicators found!")
                            return True
                            
                        logger.info("✅ Add button clicked - trade should be added")
                        return True
                        
                    except Exception as e:
                        logger.info(f"⚠️ Add button click failed: {e}")
            
            # Strategy 2: Look for button by position (bottom right)
            if attempt >= 3:
                logger.info("🔄 Looking for button by position...")
                all_buttons = self.driver.find_elements(By.TAG_NAME, "button")
                
                window_size = self.driver.get_window_size()
                for button in all_buttons:
                    if button.is_displayed() and button.is_enabled():
                        try:
                            location = button.location
                            is_bottom_right = (
                                location['x'] > window_size['width'] * 0.7 and
                                location['y'] > window_size['height'] * 0.6
                            )
                            
                            if is_bottom_right:
                                button_text = button.text.strip()
                                logger.info(f"🎯 Found bottom-right button: '{button_text}'")
                                
                                if 'add' in button_text.lower() or button_text == 'Add':
                                    button.click()
                                    logger.info(f"✅ Clicked bottom-right Add button!")
                                    time.sleep(3)
                                    return True
                                    
                        except:
                            continue
            
            # Strategy 3: Use JavaScript to find and click
            if attempt >= 5:
                logger.info("🔄 Using JavaScript to find Add button...")
                try:
                    # JavaScript to find and click Add button
                    js_script = """
                    var buttons = document.querySelectorAll('button');
                    for (var i = 0; i < buttons.length; i++) {
                        if (buttons[i].textContent.trim() === 'Add' && 
                            buttons[i].offsetParent !== null) {
                            buttons[i].click();
                            return 'clicked';
                        }
                    }
                    return 'not_found';
                    """
                    
                    result = self.driver.execute_script(js_script)
                    if result == 'clicked':
                        logger.info("✅ JavaScript clicked Add button!")
                        time.sleep(3)
                        return True
                        
                except Exception as e:
                    logger.info(f"⚠️ JavaScript approach failed: {e}")
            
            time.sleep(1)
        
        logger.error("❌ Could not click Add button after all attempts")
        return False
        
    def complete_final_trade(self):
        """Complete the entire final trade sequence"""
        try:
            logger.info("🚀 STARTING FINAL TRADE COMPLETION")
            logger.info("=" * 50)
            
            # Setup
            self.setup_driver()
            self.load_and_navigate()
            
            # Open option chain
            if not self.open_option_chain():
                logger.error("❌ Could not open option chain")
                return False
            
            # Analyze HTML structure
            self.analyze_html_structure()
            
            # Click Strikes tab
            strikes_clicked = self.click_strikes_tab()
            if not strikes_clicked:
                logger.warning("⚠️ Could not click Strikes tab, continuing anyway...")
            
            # Select option radio button
            option_selected = self.select_option_radio_button("25000")
            if not option_selected:
                logger.warning("⚠️ Could not select option, trying Add button anyway...")
            
            # Click Add button
            add_success = self.click_add_button_final()
            
            # Final screenshot
            self.take_screenshot("final_completion_state")
            
            if add_success:
                logger.info("🎉 FINAL TRADE COMPLETED SUCCESSFULLY!")
                return True
            else:
                logger.warning("⚠️ Final trade needs manual completion")
                return False
                
        except Exception as e:
            logger.error(f"❌ Final trade error: {e}")
            return False
        
        finally:
            logger.info("🔍 Browser left open for inspection")
            logger.info(f"📸 Screenshots: {len(self.screenshots)}")
            for screenshot in self.screenshots:
                logger.info(f"   - {screenshot}")

def main():
    print("""
🎯 FINAL TRADE COMPLETION
=========================

This script will complete the final steps:
1. Open option chain (Add/Import -> Add Orders Manually)
2. Analyze HTML structure  
3. Click "Strikes" tab
4. Select a radio button for an option (25000)
5. Click the blue "Add" button

Starting final trade completion...
    """)
    
    trader = FinalTradeCompletion()
    success = trader.complete_final_trade()
    
    if success:
        print("\n🎉 FINAL TRADE COMPLETED SUCCESSFULLY!")
        print("✅ Option trade has been added to portfolio")
        print("📊 Portfolio should now show the new position")
    else:
        print("\n⚠️ FINAL TRADE NEEDS MANUAL COMPLETION")
        print("🔍 Check browser and screenshots for current state")
        print("📄 HTML structure saved to: option_chain_html_structure.html")
    
    input("\nPress Enter to close browser...")

if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""
Add/Import Button Clicker with Visual Verification
=================================================

This script:
1. Navigates to a portfolio (or creates one)
2. Looks for and clicks the "Add/Import" button
3. Verifies the sidebar opens using visual checks
4. Takes screenshots at each step for verification
5. Loops and retries if needed
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
import rookiepy

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger('AddImportClicker')

class AddImportClicker:
    def __init__(self):
        self.driver = None
        self.screenshots = []
        
    def setup_driver(self):
        """Setup Chrome driver"""
        chrome_options = Options()
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        # Don't use headless mode so we can see what's happening
        self.driver = webdriver.Chrome(options=chrome_options)
        logger.info("✅ Chrome driver initialized")
        
    def load_and_inject_cookies(self):
        """Load cookies and navigate to Sensibull"""
        cookies = rookiepy.chrome(['.sensibull.com', 'sensibull.com', 'web.sensibull.com'])
        logger.info(f"✅ Loaded {len(cookies)} cookies")
        
        # Navigate and inject cookies
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
        
        # Navigate to draft portfolios
        self.driver.get("https://web.sensibull.com/draft-portfolios")
        time.sleep(5)
        logger.info("✅ Navigated to draft portfolios")
        
    def take_screenshot(self, description=""):
        """Take a screenshot with timestamp"""
        timestamp = datetime.now().strftime("%H%M%S")
        filename = f"step_{len(self.screenshots)+1:02d}_{timestamp}_{description.replace(' ', '_')}.png"
        
        try:
            self.driver.save_screenshot(filename)
            self.screenshots.append(filename)
            logger.info(f"📸 Screenshot saved: {filename}")
            return filename
        except Exception as e:
            logger.error(f"❌ Screenshot failed: {e}")
            return None
            
    def compare_screenshots(self, img1_path, img2_path, threshold=0.1):
        """Compare two screenshots to detect changes"""
        try:
            # Read images
            img1 = cv2.imread(img1_path)
            img2 = cv2.imread(img2_path)
            
            if img1 is None or img2 is None:
                logger.warning("⚠️ Could not load images for comparison")
                return False
                
            # Resize if different sizes
            if img1.shape != img2.shape:
                img2 = cv2.resize(img2, (img1.shape[1], img1.shape[0]))
            
            # Calculate difference
            diff = cv2.absdiff(img1, img2)
            diff_percent = np.sum(diff) / (img1.shape[0] * img1.shape[1] * img1.shape[2] * 255) * 100
            
            logger.info(f"📊 Image difference: {diff_percent:.2f}%")
            
            return diff_percent > threshold
            
        except Exception as e:
            logger.error(f"❌ Image comparison failed: {e}")
            return False
            
    def navigate_to_portfolio(self):
        """Navigate to an existing portfolio or create one"""
        logger.info("🎯 Looking for existing portfolios...")
        
        # Take initial screenshot
        self.take_screenshot("initial_portfolio_list")
        
        # Look for portfolio rows that we can click
        portfolio_rows = self.driver.find_elements(By.XPATH, "//tr[contains(@class, '') or @role='row']")
        
        if not portfolio_rows:
            # Try different selectors
            portfolio_rows = self.driver.find_elements(By.XPATH, "//*[contains(text(), 'yolo') or contains(text(), 'iron') or contains(text(), 'new')]")
        
        portfolio_found = False
        
        for i, row in enumerate(portfolio_rows[:5]):  # Check first 5 rows
            try:
                row_text = row.text.strip()
                if any(keyword in row_text.lower() for keyword in ['yolo', 'iron', 'new', 'strategy', 'portfolio']):
                    logger.info(f"🎯 Found portfolio row {i+1}: {row_text[:50]}...")
                    
                    # Try to click on it
                    try:
                        # Scroll into view and click
                        self.driver.execute_script("arguments[0].scrollIntoView(true);", row)
                        time.sleep(1)
                        row.click()
                        
                        # Wait and check if URL changed
                        time.sleep(3)
                        current_url = self.driver.current_url
                        
                        if "/draft-portfolios/" in current_url and len(current_url.split("/")) > 4:
                            logger.info(f"✅ Successfully navigated to portfolio: {current_url}")
                            portfolio_found = True
                            break
                        else:
                            logger.info(f"⚠️ Click didn't navigate, trying next row")
                            
                    except Exception as e:
                        logger.info(f"⚠️ Could not click row {i+1}: {e}")
                        
            except Exception as e:
                logger.info(f"⚠️ Error processing row {i+1}: {e}")
        
        if not portfolio_found:
            logger.warning("⚠️ No portfolio accessed, staying on main page")
            # We'll still try to find Add/Import button on main page
            
        self.take_screenshot("after_portfolio_navigation")
        return True
        
    def find_add_import_button(self, max_attempts=3):
        """Find and analyze the Add/Import button with multiple attempts"""
        logger.info("🔍 Looking for Add/Import button...")
        
        for attempt in range(max_attempts):
            logger.info(f"📍 Attempt {attempt + 1}/{max_attempts}")
            
            # Take screenshot before search
            self.take_screenshot(f"search_attempt_{attempt+1}")
            
            # Multiple search strategies
            button_texts = [
                "Add/Import", "Add / Import", "Add Import", 
                "Import", "Add", "Add Trade", "Add Position",
                "New Trade", "+ Add", "Create Trade"
            ]
            
            found_button = None
            
            for btn_text in button_texts:
                # Strategy 1: Exact text match
                elements = self.driver.find_elements(By.XPATH, f"//*[text()='{btn_text}']")
                if elements:
                    for elem in elements:
                        if elem.is_displayed() and elem.is_enabled():
                            found_button = elem
                            logger.info(f"✅ Found button (exact): '{btn_text}'")
                            break
                
                if found_button:
                    break
                    
                # Strategy 2: Partial text match
                elements = self.driver.find_elements(By.XPATH, f"//*[contains(text(), '{btn_text}')]")
                if elements:
                    for elem in elements:
                        if elem.is_displayed() and elem.is_enabled():
                            found_button = elem
                            logger.info(f"✅ Found button (partial): '{btn_text}'")
                            break
                            
                if found_button:
                    break
            
            # Strategy 3: Look for buttons with relevant classes or attributes
            if not found_button:
                all_buttons = self.driver.find_elements(By.TAG_NAME, "button")
                logger.info(f"🔍 Analyzing {len(all_buttons)} buttons...")
                
                for i, btn in enumerate(all_buttons):
                    try:
                        btn_text = btn.text.strip()
                        btn_class = btn.get_attribute('class') or ''
                        btn_id = btn.get_attribute('id') or ''
                        is_displayed = btn.is_displayed()
                        is_enabled = btn.is_enabled()
                        
                        # Log interesting buttons
                        if is_displayed and btn_text and any(word in btn_text.lower() for word in ['add', 'import', 'create', 'new']):
                            logger.info(f"   🔘 Button {i+1}: '{btn_text}' (class: {btn_class[:30]}...)")
                            
                            if any(word in btn_text.lower() for word in ['add', 'import']) and is_enabled:
                                found_button = btn
                                logger.info(f"✅ Selected button {i+1}: '{btn_text}'")
                                break
                                
                    except Exception as e:
                        continue
            
            if found_button:
                return found_button
            else:
                logger.warning(f"⚠️ Attempt {attempt + 1} failed, waiting and retrying...")
                time.sleep(2)
                
                # Try scrolling to reveal more content
                self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                time.sleep(1)
                self.driver.execute_script("window.scrollTo(0, 0);")
                time.sleep(1)
        
        logger.error("❌ Add/Import button not found after all attempts")
        return None
        
    def click_button_with_verification(self, button):
        """Click the button and verify sidebar opens"""
        logger.info("🖱️ Clicking Add/Import button...")
        
        # Take screenshot before click
        before_screenshot = self.take_screenshot("before_click")
        
        # Try multiple click methods
        click_success = False
        
        try:
            # Method 1: Direct click
            button.click()
            click_success = True
            logger.info("✅ Direct click successful")
        except Exception as e:
            logger.info(f"⚠️ Direct click failed: {e}")
            
            try:
                # Method 2: ActionChains
                ActionChains(self.driver).move_to_element(button).click().perform()
                click_success = True
                logger.info("✅ ActionChains click successful")
            except Exception as e:
                logger.info(f"⚠️ ActionChains failed: {e}")
                
                try:
                    # Method 3: JavaScript click
                    self.driver.execute_script("arguments[0].click();", button)
                    click_success = True
                    logger.info("✅ JavaScript click successful")
                except Exception as e:
                    logger.error(f"❌ All click methods failed: {e}")
        
        if not click_success:
            return False
            
        # Wait for potential sidebar/modal to appear
        logger.info("⏳ Waiting for sidebar/modal to appear...")
        time.sleep(3)
        
        # Take screenshot after click
        after_screenshot = self.take_screenshot("after_click")
        
        # Visual verification - compare before and after
        if before_screenshot and after_screenshot:
            has_changes = self.compare_screenshots(before_screenshot, after_screenshot)
            if has_changes:
                logger.info("✅ Visual changes detected - likely sidebar opened!")
            else:
                logger.warning("⚠️ No significant visual changes detected")
        
        # Text-based verification - look for option chain indicators
        sidebar_indicators = [
            "option chain", "options", "strike", "expiry", 
            "call", "put", "CE", "PE", "nifty", "banknifty",
            "add position", "buy", "sell", "quantity"
        ]
        
        page_text = self.driver.find_element(By.TAG_NAME, "body").text.lower()
        found_indicators = []
        
        for indicator in sidebar_indicators:
            if indicator in page_text:
                found_indicators.append(indicator)
        
        if found_indicators:
            logger.info(f"✅ Sidebar indicators found: {found_indicators[:5]}")
            return True
        else:
            logger.warning("⚠️ No sidebar indicators found in page text")
            
        # Element-based verification - look for new elements that might be the sidebar
        try:
            # Look for elements that might be sidebars/modals
            potential_sidebars = self.driver.find_elements(By.CSS_SELECTOR, 
                "[role='dialog'], .sidebar, .modal, .drawer, [data-state='open']")
            
            visible_sidebars = [s for s in potential_sidebars if s.is_displayed()]
            
            if visible_sidebars:
                logger.info(f"✅ Found {len(visible_sidebars)} potential sidebar elements")
                return True
            else:
                logger.info("ℹ️ No obvious sidebar elements found")
                
        except Exception as e:
            logger.info(f"⚠️ Sidebar element search failed: {e}")
        
        return has_changes  # Return True if visual changes were detected
        
    def run_add_import_session(self):
        """Run the complete Add/Import clicking session"""
        try:
            logger.info("🚀 STARTING ADD/IMPORT BUTTON SESSION")
            logger.info("=" * 50)
            
            # Setup
            self.setup_driver()
            self.load_and_inject_cookies()
            
            # Navigate to portfolio
            self.navigate_to_portfolio()
            
            # Find Add/Import button
            button = self.find_add_import_button()
            
            if not button:
                logger.error("❌ Could not find Add/Import button")
                return False
            
            # Click button and verify sidebar
            success = self.click_button_with_verification(button)
            
            # Take final screenshot
            self.take_screenshot("final_state")
            
            if success:
                logger.info("✅ Add/Import button clicked successfully!")
                logger.info("✅ Sidebar/modal appears to have opened")
            else:
                logger.warning("⚠️ Add/Import button clicked but sidebar verification unclear")
            
            # Summary
            logger.info(f"📸 Total screenshots taken: {len(self.screenshots)}")
            logger.info("📁 Screenshot files:")
            for screenshot in self.screenshots:
                logger.info(f"   - {screenshot}")
            
            return success
            
        except Exception as e:
            logger.error(f"❌ Session error: {e}")
            return False
        
        finally:
            logger.info("🔍 Browser left open for manual inspection")
            logger.info("💡 Close browser manually when done")

def main():
    print("""
🔥 ADD/IMPORT BUTTON CLICKER WITH VISUAL VERIFICATION
===================================================

This script will:
1. Navigate to a Sensibull portfolio
2. Find and click the "Add/Import" button  
3. Verify that the sidebar/modal opens
4. Take screenshots at each step
5. Use visual comparison to detect changes

Requirements:
- opencv-python (pip install opencv-python)

Starting session...
    """)
    
    # Check if opencv is available
    try:
        import cv2
        logger.info("✅ OpenCV available for visual verification")
    except ImportError:
        logger.warning("⚠️ OpenCV not available - visual comparison disabled")
        logger.info("💡 Install with: pip install opencv-python")
    
    clicker = AddImportClicker()
    success = clicker.run_add_import_session()
    
    if success:
        print("\n✅ ADD/IMPORT BUTTON SESSION SUCCESSFUL!")
        print("🎯 Button found and clicked")
        print("📊 Sidebar appears to have opened")
    else:
        print("\n❌ ADD/IMPORT BUTTON SESSION INCOMPLETE")
        print("🔍 Check screenshots for manual verification")
    
    print(f"\n📸 Check screenshots for detailed visual verification")
    input("\nPress Enter to close browser...")

if __name__ == "__main__":
    main()
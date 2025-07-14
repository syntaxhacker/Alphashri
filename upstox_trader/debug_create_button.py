#!/usr/bin/env python3
"""
Debug Create Button in Modal
============================

Simple script to debug the "Create" button click inside the portfolio creation modal.
"""

import time
import logging
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.action_chains import ActionChains
import rookiepy

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger('DebugCreate')

def setup_driver():
    """Setup Chrome driver"""
    chrome_options = Options()
    chrome_options.add_argument('--no-sandbox')
    chrome_options.add_argument('--disable-dev-shm-usage')
    driver = webdriver.Chrome(options=chrome_options)
    return driver

def load_and_inject_cookies(driver):
    """Load cookies and navigate to Sensibull"""
    # Load cookies
    cookies = rookiepy.chrome(['.sensibull.com', 'sensibull.com', 'web.sensibull.com'])
    logger.info(f"Loaded {len(cookies)} cookies")
    
    # Navigate and inject cookies
    driver.get("https://web.sensibull.com")
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
            driver.add_cookie(selenium_cookie)
        except:
            continue
    
    # Navigate to draft portfolios
    driver.get("https://web.sensibull.com/draft-portfolios")
    time.sleep(5)
    logger.info("✅ Navigated to draft portfolios")

def debug_create_flow(driver):
    """Debug the complete create flow"""
    logger.info("🔍 DEBUGGING CREATE BUTTON FLOW")
    logger.info("=" * 50)
    
    # Step 1: Click "Create New" to open modal
    logger.info("1️⃣ Looking for 'Create New' button...")
    create_new_elements = driver.find_elements(By.XPATH, "//*[contains(text(), 'Create New')]")
    
    if create_new_elements:
        create_new_btn = create_new_elements[0]
        logger.info(f"✅ Found 'Create New' button: {create_new_btn.text}")
        
        # Click it
        logger.info("🖱️ Clicking 'Create New'...")
        create_new_btn.click()
        time.sleep(3)
        logger.info("✅ Clicked 'Create New'")
    else:
        logger.error("❌ 'Create New' button not found")
        return False
    
    # Step 2: Wait for modal and find name input
    logger.info("2️⃣ Looking for portfolio name input...")
    time.sleep(2)
    
    name_inputs = driver.find_elements(By.CSS_SELECTOR, "input")
    logger.info(f"🔍 Found {len(name_inputs)} input fields")
    
    name_input = None
    for i, inp in enumerate(name_inputs):
        try:
            placeholder = inp.get_attribute('placeholder') or ''
            input_type = inp.get_attribute('type') or ''
            input_id = inp.get_attribute('id') or ''
            input_name = inp.get_attribute('name') or ''
            
            logger.info(f"   Input {i+1}: type='{input_type}', placeholder='{placeholder}', id='{input_id}', name='{input_name}'")
            
            if any(keyword in placeholder.lower() for keyword in ['name', 'portfolio']) or \
               any(keyword in input_id.lower() for keyword in ['name', 'portfolio']) or \
               any(keyword in input_name.lower() for keyword in ['name', 'portfolio']):
                name_input = inp
                logger.info(f"✅ Selected input {i+1} as name field")
                break
        except:
            continue
    
    if not name_input:
        # Just use the first visible input
        for inp in name_inputs:
            try:
                if inp.is_displayed() and inp.is_enabled():
                    name_input = inp
                    logger.info("✅ Using first visible input as name field")
                    break
            except:
                continue
    
    if not name_input:
        logger.error("❌ No name input field found")
        driver.save_screenshot('debug_no_name_input.png')
        return False
    
    # Step 3: Enter portfolio name
    portfolio_name = f"debug_test_{int(time.time())}"
    logger.info(f"3️⃣ Entering portfolio name: {portfolio_name}")
    
    try:
        name_input.clear()
        name_input.send_keys(portfolio_name)
        logger.info("✅ Portfolio name entered")
        time.sleep(1)
    except Exception as e:
        logger.error(f"❌ Error entering name: {e}")
        return False
    
    # Step 4: Find and analyze the "Create" button in modal
    logger.info("4️⃣ Looking for 'Create' button in modal...")
    
    # Get all buttons
    all_buttons = driver.find_elements(By.TAG_NAME, "button")
    logger.info(f"🔍 Found {len(all_buttons)} total buttons")
    
    create_button = None
    for i, btn in enumerate(all_buttons):
        try:
            btn_text = btn.text.strip()
            btn_class = btn.get_attribute('class') or ''
            btn_id = btn.get_attribute('id') or ''
            is_displayed = btn.is_displayed()
            is_enabled = btn.is_enabled()
            
            logger.info(f"   Button {i+1}: text='{btn_text}', class='{btn_class[:50]}', displayed={is_displayed}, enabled={is_enabled}")
            
            if btn_text.lower() == 'create' and is_displayed and is_enabled:
                create_button = btn
                logger.info(f"✅ Found Create button: Button {i+1}")
                break
        except Exception as e:
            logger.info(f"   Button {i+1}: Error reading - {e}")
    
    if not create_button:
        logger.error("❌ 'Create' button not found in modal")
        driver.save_screenshot('debug_no_create_button.png')
        
        # Show page source around the input for debugging
        logger.info("📄 Page source around input field:")
        try:
            parent_html = name_input.find_element(By.XPATH, "../..").get_attribute('outerHTML')
            logger.info(parent_html[:500] + "...")
        except:
            pass
        
        return False
    
    # Step 5: Click the Create button with multiple methods
    logger.info("5️⃣ Attempting to click 'Create' button...")
    
    # Method 1: Direct click
    try:
        logger.info("   Trying direct click...")
        create_button.click()
        logger.info("✅ Direct click successful")
        time.sleep(5)
        return True
    except Exception as e:
        logger.info(f"   Direct click failed: {e}")
    
    # Method 2: ActionChains
    try:
        logger.info("   Trying ActionChains click...")
        ActionChains(driver).move_to_element(create_button).click().perform()
        logger.info("✅ ActionChains click successful")
        time.sleep(5)
        return True
    except Exception as e:
        logger.info(f"   ActionChains click failed: {e}")
    
    # Method 3: JavaScript click
    try:
        logger.info("   Trying JavaScript click...")
        driver.execute_script("arguments[0].click();", create_button)
        logger.info("✅ JavaScript click successful")
        time.sleep(5)
        return True
    except Exception as e:
        logger.info(f"   JavaScript click failed: {e}")
    
    # Method 4: Force click by removing overlays
    try:
        logger.info("   Trying to remove overlays and click...")
        # Remove any potential overlays
        driver.execute_script("""
            var overlays = document.querySelectorAll('[data-state="open"], .modal-overlay, .backdrop');
            overlays.forEach(function(overlay) {
                if (overlay.style.pointerEvents !== 'none') {
                    overlay.style.pointerEvents = 'none';
                }
            });
        """)
        time.sleep(1)
        create_button.click()
        logger.info("✅ Overlay removal + click successful")
        time.sleep(5)
        return True
    except Exception as e:
        logger.info(f"   Overlay removal click failed: {e}")
    
    logger.error("❌ All click methods failed")
    driver.save_screenshot('debug_create_click_failed.png')
    return False

def main():
    print("""
🔍 DEBUG CREATE BUTTON IN MODAL
===============================

This script will:
1. Open Sensibull draft portfolios
2. Click "Create New" to open modal
3. Enter portfolio name
4. Debug the "Create" button click

Starting debug session...
    """)
    
    driver = setup_driver()
    
    try:
        # Load cookies and navigate
        load_and_inject_cookies(driver)
        
        # Debug the create flow
        success = debug_create_flow(driver)
        
        if success:
            print("\n✅ CREATE BUTTON DEBUG SUCCESSFUL!")
            print("Portfolio creation flow completed")
        else:
            print("\n❌ CREATE BUTTON DEBUG FAILED")
            print("Check screenshots and logs for details")
        
        print("\n🔍 Browser left open for manual inspection")
        input("Press Enter to close browser...")
        
    finally:
        driver.quit()

if __name__ == "__main__":
    main()
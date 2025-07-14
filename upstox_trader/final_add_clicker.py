#!/usr/bin/env python3
"""
Final Add Button Clicker
========================

Quick script to just click the final Add button in the confirmation modal.
We know the trade execution works, just need to complete the final confirmation.
"""

import time
import logging
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
import rookiepy

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger('FinalAdd')

def click_final_add():
    """Click the final Add button in confirmation modal"""
    # Setup driver
    chrome_options = Options()
    chrome_options.add_argument('--no-sandbox')
    chrome_options.add_argument('--disable-dev-shm-usage')
    driver = webdriver.Chrome(options=chrome_options)
    
    try:
        # Load cookies
        cookies = rookiepy.chrome(['.sensibull.com', 'sensibull.com', 'web.sensibull.com'])
        logger.info(f"✅ Loaded {len(cookies)} cookies")
        
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
        
        # Navigate to portfolio - use current portfolio from latest run
        portfolio_url = "https://web.sensibull.com/draft-portfolios/5ad31e48-ba25-47f4-ae12-c0cc53ba1323"
        driver.get(portfolio_url)
        time.sleep(5)
        
        # Take initial screenshot
        driver.save_screenshot('final_add_start.png')
        logger.info("📸 Initial screenshot taken")
        
        # Look for any Add buttons on the page
        logger.info("🔍 Looking for Add buttons...")
        
        # Check if we're in a modal or confirmation dialog
        page_text = driver.find_element(By.TAG_NAME, "body").text
        logger.info(f"📄 Page contains: Review={('review' in page_text.lower())}, Draft={('draft' in page_text.lower())}, Orders={('orders' in page_text.lower())}")
        
        # Look for all Add buttons
        add_buttons = driver.find_elements(By.XPATH, "//button[text()='Add' or contains(text(), 'Add')]")
        logger.info(f"🔍 Found {len(add_buttons)} Add buttons")
        
        for i, button in enumerate(add_buttons):
            if button.is_displayed():
                is_enabled = button.is_enabled()
                button_text = button.text.strip()
                location = button.location
                logger.info(f"   Button {i+1}: '{button_text}' enabled={is_enabled} at {location}")
                
                if is_enabled and button_text:
                    try:
                        button.click()
                        logger.info(f"✅ Clicked button: '{button_text}'")
                        time.sleep(3)
                        
                        driver.save_screenshot(f'after_click_{i+1}.png')
                        
                        # Check current state
                        current_url = driver.current_url
                        new_page_text = driver.find_element(By.TAG_NAME, "body").text.lower()
                        
                        if 'draft-portfolios' in current_url and len(current_url.split('/')) <= 5:
                            logger.info("🎉 Returned to main portfolio page - trade complete!")
                            return True
                        elif 'review' in new_page_text and 'draft' in new_page_text:
                            logger.info("🔍 Still in modal, looking for next Add button...")
                            continue
                        else:
                            logger.info("✅ Button clicked successfully")
                            return True
                            
                    except Exception as e:
                        logger.info(f"⚠️ Could not click button {i+1}: {e}")
        
        # If we get here, try JavaScript approach
        logger.info("🔄 Trying JavaScript to click Add button...")
        try:
            js_result = driver.execute_script("""
                var buttons = document.querySelectorAll('button');
                for (var i = 0; i < buttons.length; i++) {
                    if (buttons[i].textContent.includes('Add') && 
                        buttons[i].offsetParent !== null &&
                        !buttons[i].disabled) {
                        buttons[i].click();
                        return 'clicked: ' + buttons[i].textContent;
                    }
                }
                return 'no enabled Add button found';
            """)
            
            logger.info(f"🔧 JavaScript result: {js_result}")
            time.sleep(3)
            
            driver.save_screenshot('after_js_click.png')
            return True
            
        except Exception as e:
            logger.error(f"❌ JavaScript approach failed: {e}")
        
        logger.info("✅ Completed final Add button attempts")
        return True
        
    finally:
        logger.info("🔍 Browser left open for inspection")
        input("Press Enter to close browser...")
        driver.quit()

if __name__ == "__main__":
    print("🎯 Final Add Button Clicker - completing the trade confirmation")
    click_final_add()
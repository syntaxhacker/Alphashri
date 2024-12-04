import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import time
import logging
import os
from typing import Dict, List
import threading
import queue
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
from bs4 import BeautifulSoup
from functools import lru_cache
from tenacity import retry, stop_after_attempt, wait_exponential
from concurrent.futures import ThreadPoolExecutor
import smtplib
from email.mime.text import MIMEText

class IntradayTrader:
    def __init__(self):
        self.setup_logging()
        self.symbols = []  # List of stocks to monitor
        self.positions: Dict[str, float] = {}  # Current positions
        self.data_queue = queue.Queue()  # Queue for real-time data
        self.stop_threads = False
        self.max_workers = 1  # Reduced from 3 to 1 for better visibility
        self.setup_browser_pool()
        
        # Trading parameters
        self.rsi_period = 14
        self.rsi_overbought = 70
        self.rsi_oversold = 30
        self.volume_threshold = 100000  # Minimum volume for trading
        self.cache_timeout = 60  # seconds
        self.cache = {}
        
    def setup_browser_pool(self):
        """Setup multiple browser instances for parallel processing"""
        self.browsers = []
        for _ in range(self.max_workers):
            options = webdriver.ChromeOptions()
            # Remove headless mode to see the chart
            # options.add_argument('--headless')
            options.add_argument('--no-sandbox')
            options.add_argument('--disable-dev-shm-usage')
            options.add_argument('--start-maximized')
            
            # Add user agent
            options.add_argument('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
            
            # Don't disable images as we need them for the chart
            prefs = {
                "profile.default_content_settings.popups": 0,
                "download.default_directory": os.getcwd(),
            }
            options.add_experimental_option("prefs", prefs)
            options.add_experimental_option('excludeSwitches', ['enable-logging'])
            
            try:
                browser = webdriver.Chrome(
                    service=Service(ChromeDriverManager().install()),
                    options=options
                )
                # Add implicit wait
                browser.implicitly_wait(10)
                
                # Set window size for better chart visibility
                browser.set_window_size(1920, 1080)
                
                self.browsers.append(browser)
                logging.info("Browser instance created successfully")
            except Exception as e:
                logging.error(f"Failed to create browser instance: {str(e)}")
            
    def get_cached_data(self, symbol: str) -> dict:
        """Get cached data if it exists and is not expired"""
        if symbol in self.cache:
            data, timestamp = self.cache[symbol]
            if datetime.now() - timestamp < timedelta(seconds=self.cache_timeout):
                return data
        return None
        
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=10),
        retry_error_callback=lambda retry_state: None
    )
    def get_tradingview_data(self, symbol: str, browser: webdriver.Chrome) -> dict:
        """Get real-time market data from TradingView's chart view"""
        try:
            # First navigate to symbol page
            url = f"https://www.tradingview.com/symbols/NSE-{symbol}/"
            logging.info(f"Navigating to symbol page: {url}")
            browser.get(url)
            time.sleep(2)
            
            try:
                # Wait for and click the "Full Chart" button
                wait = WebDriverWait(browser, 20)
                full_chart_button = wait.until(
                    EC.element_to_be_clickable((By.XPATH, "//a[contains(@class, 'tv-feed-widget__chart-link')]"))
                )
                logging.info("Clicking Full Chart button")
                full_chart_button.click()
                
                # Switch to the new tab that opens
                time.sleep(3)  # Wait for new tab
                browser.switch_to.window(browser.window_handles[-1])
                
                # Wait for chart to load
                time.sleep(5)
                
                # Now get the price from chart view
                price_element = wait.until(
                    EC.presence_of_element_located((By.CLASS_NAME, "price-3PT4Oe1W"))
                )
                
                # Extract price
                price_text = price_element.text.strip()
                logging.info(f"Found price: {price_text}")
                price = float(price_text.replace(',', ''))
                
                # Get RSI from indicators panel
                rsi_button = wait.until(
                    EC.presence_of_element_located((By.XPATH, "//div[contains(@data-name, 'RSI')]"))
                )
                rsi_value = wait.until(
                    EC.presence_of_element_located((By.CLASS_NAME, "valueValue-2KhwsEwE"))
                )
                rsi = float(rsi_value.text)
                
                # Get volume from the volume panel
                volume_value = wait.until(
                    EC.presence_of_element_located((By.CLASS_NAME, "valueValue-2KhwsEwE"))
                )
                volume = float(volume_value.text.replace(',', '').replace('K', '000').replace('M', '000000'))
                
                result = {
                    'symbol': symbol,
                    'price': price,
                    'volume': volume,
                    'rsi': rsi,
                    'timestamp': datetime.now()
                }
                logging.info(f"Successfully fetched data for {symbol}: {result}")
                
                # Close the chart tab and switch back to main window
                browser.close()
                browser.switch_to.window(browser.window_handles[0])
                
                return result
                
            except Exception as e:
                logging.error(f"Error parsing data for {symbol}: {str(e)}")
                # Make sure to switch back to main window if error occurs
                if len(browser.window_handles) > 1:
                    browser.close()
                    browser.switch_to.window(browser.window_handles[0])
                return None
                
        except Exception as e:
            logging.error(f"Error accessing TradingView for {symbol}: {str(e)}")
            return None

    def data_stream(self):
        """Continuously stream market data using multiple browsers"""
        while not self.stop_threads:
            with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
                futures = []
                for i, symbol in enumerate(self.symbols):
                    browser = self.browsers[i % self.max_workers]
                    futures.append(
                        executor.submit(self.get_tradingview_data, symbol, browser)
                    )
                
                for future in futures:
                    data = future.result()
                    if data:
                        self.data_queue.put(data)
                        
            time.sleep(60)

    def setup_logging(self):
        if not os.path.exists('logs'):
            os.makedirs('logs')
        log_filename = 'logs/intraday_trading.log'
        with open(log_filename, 'w') as f:
            f.write('')
        
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler(log_filename),
                logging.StreamHandler()
            ]
        )

    def calculate_rsi(self, data: pd.Series, periods: int = 14) -> float:
        """Calculate RSI technical indicator"""
        delta = data.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=periods).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=periods).mean()
        
        rs = gain / loss
        rsi = 100 - (100 / (1 + rs))
        return rsi.iloc[-1]

    def generate_signals(self, data: dict) -> str:
        """Generate trading signals based on technical analysis"""
        if data['volume'] < self.volume_threshold:
            return 'HOLD'
            
        if data['rsi'] < self.rsi_oversold:
            return 'BUY'
        elif data['rsi'] > self.rsi_overbought:
            return 'SELL'
        
        return 'HOLD'

    def execute_trade(self, symbol: str, action: str, price: float):
        """Execute trading orders"""
        try:
            if action == 'BUY' and symbol not in self.positions:
                # Implement your buy logic here
                self.positions[symbol] = price
                logging.info(f"BUY {symbol} at ₹{price:.2f}")
                
            elif action == 'SELL' and symbol in self.positions:
                entry_price = self.positions[symbol]
                profit = price - entry_price
                profit_pct = (profit / entry_price) * 100
                
                # Implement your sell logic here
                del self.positions[symbol]
                logging.info(f"SELL {symbol} at ₹{price:.2f} (Profit: {profit_pct:.2f}%)")
                
        except Exception as e:
            logging.error(f"Trade execution error for {symbol}: {str(e)}")

    def risk_management(self, symbol: str, current_price: float):
        """Implement risk management rules"""
        if symbol in self.positions:
            entry_price = self.positions[symbol]
            loss_pct = ((current_price - entry_price) / entry_price) * 100
            
            # Stop loss at -2%
            if loss_pct < -2:
                logging.warning(f"Stop loss triggered for {symbol}")
                self.execute_trade(symbol, 'SELL', current_price)

    def start_trading(self, symbols: List[str]):
        """Start the trading process"""
        self.symbols = symbols
        logging.info(f"Starting intraday trading for: {', '.join(symbols)}")
        
        # Start data streaming thread
        data_thread = threading.Thread(target=self.data_stream)
        data_thread.start()
        
        try:
            while True:
                if not self.data_queue.empty():
                    data = self.data_queue.get()
                    symbol = data['symbol']
                    price = data['price']
                    
                    # Generate and execute trading signals
                    signal = self.generate_signals(data)
                    if signal != 'HOLD':
                        self.execute_trade(symbol, signal, price)
                    
                    # Risk management
                    self.risk_management(symbol, price)
                    
                    # Log current status
                    logging.info(
                        f"{symbol} - Price: ₹{price:.2f}, RSI: {data['rsi']:.2f}, "
                        f"Signal: {signal}"
                    )
                
                time.sleep(1)  # Prevent CPU overload
                
        except KeyboardInterrupt:
            logging.info("Stopping trading system...")
            self.stop_threads = True
            data_thread.join()
            
            # Close all positions
            for symbol, entry_price in list(self.positions.items()):
                current_data = self.get_tradingview_data(symbol)
                if current_data:
                    self.execute_trade(symbol, 'SELL', current_data['price'])

    def __del__(self):
        """Cleanup method to close the browser"""
        if hasattr(self, 'driver'):
            self.driver.quit()

    def send_alert(self, subject: str, message: str):
        """Send email alert for critical errors"""
        try:
            msg = MIMEText(message)
            msg['Subject'] = subject
            msg['From'] = "your-email@example.com"
            msg['To'] = "your-alert-email@example.com"
            
            with smtplib.SMTP('smtp.gmail.com', 587) as server:
                server.starttls()
                server.login("your-email@example.com", "your-app-password")
                server.send_message(msg)
                
        except Exception as e:
            logging.error(f"Failed to send alert: {str(e)}")
            
    def monitor_system_health(self):
        """Monitor system health and send alerts if needed"""
        while not self.stop_threads:
            # Check if we're getting data
            if self.data_queue.empty():
                self.send_alert(
                    "Trading System Alert",
                    "No data received in the last 5 minutes"
                )
            
            # Check browser status
            for browser in self.browsers:
                if not browser.service.is_connectable():
                    self.send_alert(
                        "Trading System Alert",
                        "Browser disconnected - attempting restart"
                    )
                    self.setup_browser_pool()
                    
            time.sleep(300)  # Check every 5 minutes

def main():
    trader = IntradayTrader()
    # Start with just one stock for testing
    symbols = ['RELIANCE']
    trader.start_trading(symbols)

if __name__ == "__main__":
    main() 
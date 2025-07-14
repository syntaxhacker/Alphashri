import rookiepy
import requests
from bs4 import BeautifulSoup
import pandas as pd
from rich.console import Console
from rich.table import Table
from datetime import datetime
import time
import random
import argparse
from urllib.parse import urljoin, quote_plus
import json
import sqlite3
import os
from pathlib import Path

console = Console()

class ProductTracker:
    def __init__(self, db_path="product_tracker.db"):
        self.db_path = db_path
        self.init_database()
    
    def init_database(self):
        """Initialize the tracking database"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Create products table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS tracked_products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                url TEXT UNIQUE NOT NULL,
                asin TEXT,
                added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                target_price REAL,
                alert_enabled BOOLEAN DEFAULT 1,
                notes TEXT
            )
        ''')
        
        # Create price history table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS price_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER,
                current_price REAL,
                original_price REAL,
                discount_percent REAL,
                rating REAL,
                reviews_count INTEGER,
                availability TEXT,
                checked_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (product_id) REFERENCES tracked_products (id)
            )
        ''')
        
        conn.commit()
        conn.close()
    
    def add_product(self, product_data, target_price=None, notes=None):
        """Add a product to tracking list"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            # Extract ASIN from URL
            asin = self.extract_asin(product_data.get('url', ''))
            
            cursor.execute('''
                INSERT OR REPLACE INTO tracked_products 
                (name, url, asin, target_price, notes)
                VALUES (?, ?, ?, ?, ?)
            ''', (
                product_data.get('title', 'Unknown Product'),
                product_data.get('url', ''),
                asin,
                target_price,
                notes
            ))
            
            product_id = cursor.lastrowid
            
            # Add initial price data
            self.add_price_record(cursor, product_id, product_data)
            
            conn.commit()
            console.print(f"[green]✓ Added '{product_data.get('title', 'Unknown')}' to tracking list[/green]")
            return product_id
            
        except sqlite3.IntegrityError:
            console.print(f"[yellow]Product already being tracked: {product_data.get('title', 'Unknown')}[/yellow]")
            return None
        finally:
            conn.close()
    
    def extract_asin(self, url):
        """Extract ASIN from Amazon URL"""
        import re
        match = re.search(r'/dp/([A-Z0-9]{10})', url)
        return match.group(1) if match else None
    
    def add_price_record(self, cursor, product_id, product_data):
        """Add a price record to history"""
        current_price = self.extract_numeric_price(product_data.get('current_price', '0'))
        original_price = self.extract_numeric_price(product_data.get('original_price', '0'))
        discount_percent = self.extract_numeric_discount(product_data.get('discount_percent', '0%'))
        rating = float(product_data.get('rating', 0)) if product_data.get('rating', 'N/A') != 'N/A' else None
        reviews_count = product_data.get('reviews_count_numeric', 0)
        
        cursor.execute('''
            INSERT INTO price_history 
            (product_id, current_price, original_price, discount_percent, rating, reviews_count, availability)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            product_id,
            current_price,
            original_price,
            discount_percent,
            rating,
            reviews_count,
            product_data.get('availability', 'In Stock')
        ))
    
    def extract_numeric_price(self, price_str):
        """Extract numeric value from price string"""
        if not price_str or price_str == 'N/A':
            return None
        import re
        numbers = re.findall(r'[\d,]+', str(price_str).replace(',', ''))
        return float(''.join(numbers)) if numbers else None
    
    def extract_numeric_discount(self, discount_str):
        """Extract numeric discount percentage"""
        if not discount_str or discount_str == 'N/A':
            return None
        import re
        numbers = re.findall(r'\d+', str(discount_str))
        return float(numbers[0]) if numbers else None
    
    def list_tracked_products(self):
        """List all tracked products"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT tp.id, tp.name, tp.target_price, tp.added_date, tp.notes,
                   ph.current_price, ph.original_price, ph.discount_percent, 
                   ph.rating, ph.reviews_count, ph.checked_date
            FROM tracked_products tp
            LEFT JOIN price_history ph ON tp.id = ph.product_id
            WHERE ph.id = (
                SELECT MAX(id) FROM price_history WHERE product_id = tp.id
            ) OR ph.id IS NULL
            ORDER BY tp.added_date DESC
        ''')
        
        products = cursor.fetchall()
        conn.close()
        
        if not products:
            console.print("[yellow]No products being tracked[/yellow]")
            return
        
        table = Table(title="Tracked Products", show_header=True, header_style="bold cyan")
        table.add_column("ID", justify="right")
        table.add_column("Product Name", justify="left", max_width=30)
        table.add_column("Current Price", justify="right")
        table.add_column("Target Price", justify="right")
        table.add_column("Discount", justify="center")
        table.add_column("Rating", justify="center")
        table.add_column("Last Checked", justify="center")
        
        for product in products:
            product_id, name, target_price, added_date, notes, current_price, original_price, discount_percent, rating, reviews_count, checked_date = product
            
            # Color coding for target price
            price_color = "white"
            if target_price and current_price:
                if current_price <= target_price:
                    price_color = "bold green"
                elif current_price <= target_price * 1.1:
                    price_color = "yellow"
            
            table.add_row(
                str(product_id),
                f"[cyan]{name[:30]}...[/cyan]" if len(name) > 30 else f"[cyan]{name}[/cyan]",
                f"[{price_color}]₹{current_price:,.0f}[/{price_color}]" if current_price else "N/A",
                f"₹{target_price:,.0f}" if target_price else "Not Set",
                f"{discount_percent:.0f}%" if discount_percent else "N/A",
                f"{rating:.1f}" if rating else "N/A",
                checked_date.split(' ')[0] if checked_date else "Never"
            )
        
        console.print(table)
    
    def remove_product(self, product_id):
        """Remove a product from tracking"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Get product name first
        cursor.execute('SELECT name FROM tracked_products WHERE id = ?', (product_id,))
        result = cursor.fetchone()
        
        if not result:
            console.print(f"[red]Product with ID {product_id} not found[/red]")
            conn.close()
            return
        
        product_name = result[0]
        
        # Delete price history first (foreign key constraint)
        cursor.execute('DELETE FROM price_history WHERE product_id = ?', (product_id,))
        
        # Delete product
        cursor.execute('DELETE FROM tracked_products WHERE id = ?', (product_id,))
        
        conn.commit()
        conn.close()
        
        console.print(f"[green]✓ Removed '{product_name}' from tracking list[/green]")
    
    def update_prices(self, scraper):
        """Update prices for all tracked products"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('SELECT id, name, url FROM tracked_products')
        products = cursor.fetchall()
        
        if not products:
            console.print("[yellow]No products to update[/yellow]")
            conn.close()
            return
        
        console.print(f"[yellow]Updating prices for {len(products)} tracked products...[/yellow]")
        
        for product_id, name, url in products:
            console.print(f"[cyan]Checking: {name[:40]}...[/cyan]")
            
            # Get current product data
            product_data = scraper.get_product_from_url(url)
            
            if product_data:
                # Add new price record
                self.add_price_record(cursor, product_id, product_data)
                
                # Check for price alerts
                self.check_price_alert(cursor, product_id, product_data)
            else:
                console.print(f"[red]Failed to update: {name}[/red]")
            
            # Rate limiting
            time.sleep(2)
        
        conn.commit()
        conn.close()
        console.print("[green]✓ Price update completed[/green]")
    
    def check_price_alert(self, cursor, product_id, product_data):
        """Check if price alert should be triggered"""
        cursor.execute('SELECT name, target_price, alert_enabled FROM tracked_products WHERE id = ?', (product_id,))
        result = cursor.fetchone()
        
        if not result or not result[2]:  # alert_enabled
            return
        
        name, target_price, _ = result
        current_price = self.extract_numeric_price(product_data.get('current_price', '0'))
        
        if target_price and current_price and current_price <= target_price:
            console.print(f"[bold green]🎯 PRICE ALERT: {name} is now ₹{current_price:,.0f} (Target: ₹{target_price:,.0f})[/bold green]")

def get_amazon_cookies():
    """Get Amazon cookies from browser similar to TV screener"""
    try:
        # Try Chrome first
        cookies = rookiepy.to_cookiejar(rookiepy.chrome(['.amazon.in', '.amazon.com']))
        console.print("[green]Successfully loaded cookies from Chrome[/green]")
        return cookies
    except Exception as chrome_error:
        console.print("[yellow]Could not load cookies from Chrome, trying Firefox...[/yellow]")
        try:
            # Try Firefox if Chrome fails
            cookies = rookiepy.to_cookiejar(rookiepy.firefox(['.amazon.in', '.amazon.com']))
            console.print("[green]Successfully loaded cookies from Firefox[/green]")
            return cookies
        except Exception as firefox_error:
            console.print("[red]Could not load cookies from any browser. Using session without cookies.[/red]")
            console.print("[yellow]Please make sure you're logged into Amazon in your browser.[/yellow]")
            return None

class AmazonScraper:
    def __init__(self, domain='amazon.in'):
        self.domain = domain
        self.base_url = f"https://www.{domain}"
        self.session = requests.Session()
        self.cookies = get_amazon_cookies()
        
        # Set up session with cookies and headers
        if self.cookies:
            self.session.cookies = self.cookies
            
        # User agents to rotate
        self.user_agents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        ]
        
        self.session.headers.update({
            'User-Agent': random.choice(self.user_agents),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        })
        
    def get_page(self, url, retries=3):
        """Get page with retry logic and random delays"""
        for attempt in range(retries):
            try:
                # Random delay between requests
                time.sleep(random.uniform(1, 3))
                
                # Rotate user agent
                self.session.headers['User-Agent'] = random.choice(self.user_agents)
                
                response = self.session.get(url, timeout=10)
                
                if response.status_code == 200:
                    return response
                elif response.status_code == 503:
                    console.print(f"[yellow]Service unavailable (503), retrying in {2 ** attempt} seconds...[/yellow]")
                    time.sleep(2 ** attempt)
                else:
                    console.print(f"[red]HTTP {response.status_code} for {url}[/red]")
                    
            except Exception as e:
                console.print(f"[red]Error fetching {url}: {str(e)}[/red]")
                if attempt < retries - 1:
                    time.sleep(2 ** attempt)
                    
        return None
        
    def search_products(self, query, max_pages=5, min_rating=4.0, min_reviews=100, apply_filters=True):
        """Search for products on Amazon with quality filters"""
        products = []
        filtered_count = 0
        
        for page in range(1, max_pages + 1):
            console.print(f"[yellow]Scraping page {page} for '{query}'...[/yellow]")
            
            search_url = f"{self.base_url}/s?k={quote_plus(query)}&page={page}"
            response = self.get_page(search_url)
            
            if not response:
                console.print(f"[red]Failed to fetch page {page}[/red]")
                continue
                
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Check if we're blocked
            if 'robot check' in response.text.lower() or 'captcha' in response.text.lower():
                console.print("[red]Detected CAPTCHA or robot check. Please solve it manually in browser.[/red]")
                break
                
            # Find product containers - try multiple selectors
            product_containers = soup.find_all('div', {'data-component-type': 's-search-result'})
            
            # Fallback selectors if main one doesn't work
            if not product_containers:
                product_containers = soup.find_all('div', class_='s-result-item')
                
            if not product_containers:
                product_containers = soup.find_all('div', attrs={'data-asin': True})
                
            if not product_containers:
                console.print(f"[yellow]No products found on page {page}. Checking page structure...[/yellow]")
                # Debug: check what we actually got
                console.print(f"Page title: {soup.title.string if soup.title else 'No title'}")
                if 'captcha' in response.text.lower() or 'robot' in response.text.lower():
                    console.print("[red]CAPTCHA detected. Please solve it in your browser.[/red]")
                break
                
            for container in product_containers:
                product = self.extract_product_info(container)
                if product:
                    # Apply quality filters if enabled
                    if apply_filters:
                        if self.meets_quality_criteria(product, min_rating, min_reviews):
                            products.append(product)
                        else:
                            filtered_count += 1
                    else:
                        products.append(product)
        
        if apply_filters and filtered_count > 0:
            console.print(f"[yellow]Filtered out {filtered_count} products not meeting quality criteria (Rating: {min_rating}+, Reviews: {min_reviews}+)[/yellow]")
                    
        return products
        
    def extract_product_info(self, container):
        """Extract product information from container"""
        try:
            product = {}
            
            # Product title - try multiple selectors
            title_elem = container.find('h2')
            if title_elem:
                title_link = title_elem.find('a')
                if title_link:
                    title_text = title_link.get_text(strip=True)
                    # Filter out promotional text
                    if len(title_text) > 15 and not any(x in title_text.lower() for x in ['sponsored', 'prime day', 'just for prime']):
                        product['title'] = title_text
                        product['url'] = urljoin(self.base_url, title_link.get('href', ''))
            
            # Try different title selectors as fallback
            if not product.get('title'):
                # Look for product links with decent length text
                all_links = container.find_all('a')
                for link in all_links:
                    text = link.get_text(strip=True)
                    href = link.get('href', '')
                    # Check if it looks like a product link
                    if (len(text) > 20 and len(text) < 200 and 
                        '/dp/' in href and 
                        not any(x in text.lower() for x in ['sponsored', 'prime day', 'see more', 'learn more'])):
                        product['title'] = text
                        product['url'] = urljoin(self.base_url, href)
                        break
            
            # Price information - enhanced to capture discounts
            self.extract_price_info(container, product)
            
            # Extract additional product details
            self.extract_additional_details(container, product)
            
            return product if product.get('title') else None
            
        except Exception as e:
            console.print(f"[red]Error extracting product info: {str(e)}[/red]")
            return None
            
    def get_product_details(self, product_url):
        """Get detailed product information from product page"""
        response = self.get_page(product_url)
        if not response:
            return {}
            
        soup = BeautifulSoup(response.content, 'html.parser')
        details = {}
        
        try:
            # Product features
            feature_bullets = soup.find('div', {'id': 'feature-bullets'})
            if feature_bullets:
                features = []
                for li in feature_bullets.find_all('li'):
                    text = li.get_text(strip=True)
                    if text and not text.startswith('Make sure'):
                        features.append(text)
                details['features'] = features[:5]  # Top 5 features
                
            # Product description
            description_elem = soup.find('div', {'id': 'productDescription'})
            if description_elem:
                details['description'] = description_elem.get_text(strip=True)[:500]
                
            # Brand
            brand_elem = soup.find('a', {'id': 'bylineInfo'})
            if brand_elem:
                details['brand'] = brand_elem.get_text(strip=True).replace('Visit the', '').replace('Store', '').strip()
                
        except Exception as e:
            console.print(f"[red]Error getting product details: {str(e)}[/red]")
            
        return details
        
    def analyze_prices(self, products):
        """Analyze price patterns in scraped products"""
        if not products:
            return {}
            
        prices = []
        for product in products:
            price_text = product.get('price', '')
            try:
                # Extract numeric price
                price_clean = ''.join(filter(str.isdigit, price_text.replace(',', '')))
                if price_clean:
                    prices.append(float(price_clean))
            except:
                continue
                
        if not prices:
            return {}
            
        analysis = {
            'min_price': min(prices),
            'max_price': max(prices),
            'avg_price': sum(prices) / len(prices),
            'median_price': sorted(prices)[len(prices) // 2],
            'total_products': len(products),
            'price_range_10k': len([p for p in prices if p <= 10000]),
            'price_range_50k': len([p for p in prices if 10000 < p <= 50000]),
            'price_range_above_50k': len([p for p in prices if p > 50000])
        }
        
        return analysis
    
    def analyze_discounts(self, products):
        """Analyze discount patterns in scraped products"""
        if not products:
            return {}
            
        discounts = []
        total_savings = 0
        discounted_count = 0
        
        for product in products:
            discount_text = product.get('discount_percent', '0%')
            if discount_text != 'N/A' and discount_text != '0%':
                try:
                    discount_num = float(discount_text.replace('%', ''))
                    if discount_num > 0:
                        discounts.append(discount_num)
                        discounted_count += 1
                        
                        # Calculate savings
                        discount_amount_text = product.get('discount_amount', '₹0')
                        try:
                            savings = float(''.join(filter(str.isdigit, discount_amount_text.replace(',', ''))))
                            total_savings += savings
                        except:
                            pass
                except:
                    continue
                    
        if not discounts:
            return {}
            
        analysis = {
            'discounted_products': discounted_count,
            'total_products': len(products),
            'discount_percentage': (discounted_count / len(products)) * 100,
            'avg_discount': sum(discounts) / len(discounts),
            'max_discount': max(discounts),
            'min_discount': min(discounts),
            'total_savings': total_savings
        }
        
        return analysis
        
    def display_results(self, products, title="Amazon Products"):
        """Display results in a rich table with enhanced information"""
        if not products:
            console.print(f"[yellow]No products found for {title}[/yellow]")
            return
            
        table = Table(title=title, show_header=True, header_style="bold cyan", border_style="blue")
        
        table.add_column("Title", justify="left", max_width=25)
        table.add_column("Current Price", justify="right")
        table.add_column("Original Price", justify="right")
        table.add_column("Discount", justify="center")
        table.add_column("Rating", justify="center")
        table.add_column("Reviews", justify="right")
        table.add_column("Prime", justify="center")
        
        for product in products[:20]:  # Show top 20 results
            title_text = product.get('title', 'N/A')
            if len(title_text) > 25:
                title_text = title_text[:22] + "..."
                
            current_price = product.get('current_price', product.get('price', 'N/A'))
            original_price = product.get('original_price', 'N/A')
            discount = product.get('discount_percent', 'N/A')
            rating = product.get('rating', 'N/A')
            reviews = product.get('reviews_count', 'N/A')
            prime = "✓" if product.get('prime') else "✗"
            
            # Color coding
            prime_color = "green" if product.get('prime') else "red"
            
            # Discount color coding
            discount_color = "white"
            if discount != 'N/A' and discount != "0%":
                try:
                    discount_num = int(discount.replace('%', ''))
                    if discount_num >= 50:
                        discount_color = "bold red"
                    elif discount_num >= 30:
                        discount_color = "red"
                    elif discount_num >= 15:
                        discount_color = "yellow"
                    elif discount_num > 0:
                        discount_color = "green"
                except:
                    pass
            
            # Price color coding
            price_color = "green" if current_price != 'N/A' else "white"
            original_price_color = "dim white" if original_price != 'N/A' else "white"
            
            # Review count color coding
            review_color = "white"
            if reviews != 'N/A':
                review_count_numeric = product.get('reviews_count_numeric', 0)
                if review_count_numeric >= 1000:
                    review_color = "bold green"
                elif review_count_numeric >= 500:
                    review_color = "green"
                elif review_count_numeric >= 100:
                    review_color = "yellow"
            
            table.add_row(
                f"[cyan]{title_text}[/cyan]",
                f"[{price_color}]{current_price}[/{price_color}]",
                f"[{original_price_color}]{original_price}[/{original_price_color}]" if original_price != 'N/A' else original_price,
                f"[{discount_color}]{discount}[/{discount_color}]",
                f"[yellow]{rating}[/yellow]" if rating != 'N/A' else rating,
                f"[{review_color}]{reviews}[/{review_color}]",
                f"[{prime_color}]{prime}[/{prime_color}]"
            )
            
        console.print(table)
        
    def save_results(self, products, filename_prefix="amazon_scrape"):
        """Save results to CSV file"""
        if not products:
            return
            
        df = pd.DataFrame(products)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{filename_prefix}_{timestamp}.csv"
        
        df.to_csv(filename, index=False)
        console.print(f"[green]Results saved to: {filename}[/green]")
        
        return filename
    
    def get_product_from_url(self, url):
        """Get product data from a specific Amazon URL"""
        try:
            response = self.get_page(url)
            if not response:
                return None
                
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Extract basic product info from product page
            product = {}
            
            # Product title
            title_elem = soup.find('span', {'id': 'productTitle'})
            if title_elem:
                product['title'] = title_elem.get_text(strip=True)
            
            # Current price
            price_selectors = [
                'span.a-price.a-text-price.a-size-medium.apexPriceToPay span.a-offscreen',
                'span.a-price.a-size-large.a-color-price span.a-offscreen',
                'span#priceblock_dealprice',
                'span#priceblock_ourprice'
            ]
            
            for selector in price_selectors:
                price_elem = soup.select_one(selector)
                if price_elem:
                    product['current_price'] = price_elem.get_text(strip=True)
                    product['price'] = product['current_price']
                    break
            
            # Original price (MRP)
            mrp_selectors = [
                'span.a-price.a-text-price span.a-offscreen',
                'span#listPrice',
                'span#savings_percentage'
            ]
            
            for selector in mrp_selectors:
                mrp_elem = soup.select_one(selector)
                if mrp_elem and '₹' in mrp_elem.get_text():
                    product['original_price'] = mrp_elem.get_text(strip=True)
                    break
            
            # Rating
            rating_elem = soup.select_one('span.a-icon-alt')
            if rating_elem:
                rating_text = rating_elem.get_text(strip=True)
                if 'out of' in rating_text:
                    product['rating'] = rating_text.split()[0]
            
            # Review count
            review_elem = soup.select_one('span#acrCustomerReviewText')
            if review_elem:
                product['reviews_count'] = review_elem.get_text(strip=True)
                # Extract numeric value
                import re
                numbers = re.findall(r'[\d,]+', product['reviews_count'].replace(',', ''))
                if numbers:
                    product['reviews_count_numeric'] = int(''.join(numbers))
            
            # Availability
            availability_elem = soup.select_one('div#availability span')
            if availability_elem:
                product['availability'] = availability_elem.get_text(strip=True)
            
            # URL
            product['url'] = url
            
            # Calculate discount if both prices available
            self.extract_price_info_from_data(product)
            
            return product
            
        except Exception as e:
            console.print(f"[red]Error fetching product from URL: {str(e)}[/red]")
            return None
    
    def extract_price_info_from_data(self, product):
        """Calculate discount info from existing price data"""
        if product.get('current_price') and product.get('original_price'):
            try:
                current_num = float(''.join(filter(str.isdigit, product['current_price'].replace(',', ''))))
                original_num = float(''.join(filter(str.isdigit, product['original_price'].replace(',', ''))))
                
                if original_num > current_num:
                    discount_amount = original_num - current_num
                    discount_percent = (discount_amount / original_num) * 100
                    
                    product['discount_amount'] = f"₹{discount_amount:,.0f}"
                    product['discount_percent'] = f"{discount_percent:.0f}%"
                    product['savings'] = f"Save ₹{discount_amount:,.0f} ({discount_percent:.0f}%)"
                else:
                    product['discount_percent'] = "0%"
                    product['savings'] = "No discount"
            except:
                product['discount_percent'] = "N/A"
                product['savings'] = "N/A"
    
    def extract_price_info(self, container, product):
        """Extract comprehensive price information including discounts"""
        try:
            # Current/discounted price
            price_container = container.find('span', class_='a-price')
            if price_container:
                current_price_elem = price_container.find('span', class_='a-offscreen')
                if current_price_elem:
                    product['current_price'] = current_price_elem.get_text(strip=True)
                    product['price'] = product['current_price']  # For backward compatibility
            
            # Fallback current price selector
            if not product.get('current_price'):
                price_whole = container.find('span', class_='a-price-whole')
                if price_whole:
                    price_fraction = container.find('span', class_='a-price-fraction')
                    if price_fraction:
                        product['current_price'] = f"₹{price_whole.get_text(strip=True)}.{price_fraction.get_text(strip=True)}"
                    else:
                        product['current_price'] = f"₹{price_whole.get_text(strip=True)}"
                    product['price'] = product['current_price']
            
            # Original price (M.R.P)
            mrp_elem = container.find('span', class_='a-price a-text-price')
            if mrp_elem:
                mrp_price = mrp_elem.find('span', class_='a-offscreen')
                if mrp_price:
                    product['original_price'] = mrp_price.get_text(strip=True)
            
            # Alternative original price selectors
            if not product.get('original_price'):
                # Look for text containing "M.R.P"
                mrp_spans = container.find_all('span', string=lambda text: text and 'M.R.P' in text)
                for span in mrp_spans:
                    # Find price near M.R.P text
                    parent = span.find_parent()
                    if parent:
                        price_spans = parent.find_all('span', class_='a-offscreen')
                        for price_span in price_spans:
                            price_text = price_span.get_text(strip=True)
                            if '₹' in price_text and price_text != product.get('current_price'):
                                product['original_price'] = price_text
                                break
                    if product.get('original_price'):
                        break
            
            # Calculate discount information
            if product.get('current_price') and product.get('original_price'):
                try:
                    # Extract numeric values
                    current_num = float(''.join(filter(str.isdigit, product['current_price'].replace(',', ''))))
                    original_num = float(''.join(filter(str.isdigit, product['original_price'].replace(',', ''))))
                    
                    if original_num > current_num:
                        discount_amount = original_num - current_num
                        discount_percent = (discount_amount / original_num) * 100
                        
                        product['discount_amount'] = f"₹{discount_amount:,.0f}"
                        product['discount_percent'] = f"{discount_percent:.0f}%"
                        product['savings'] = f"Save ₹{discount_amount:,.0f} ({discount_percent:.0f}%)"
                    else:
                        product['discount_percent'] = "0%"
                        product['savings'] = "No discount"
                except:
                    product['discount_percent'] = "N/A"
                    product['savings'] = "N/A"
            else:
                product['discount_percent'] = "N/A"
                product['savings'] = "No discount info"
                
        except Exception as e:
            console.print(f"[red]Error extracting price info: {str(e)}[/red]")
    
    def extract_additional_details(self, container, product):
        """Extract additional product details"""
        try:
            # Rating
            rating_elem = container.find('span', class_='a-icon-alt')
            if rating_elem:
                rating_text = rating_elem.get_text(strip=True)
                if 'out of' in rating_text:
                    product['rating'] = rating_text.split()[0]
                    
            # Number of reviews - enhanced parsing
            self.extract_review_count(container, product)
                    
            # Image URL
            img_elem = container.find('img', class_='s-image')
            if img_elem:
                product['image_url'] = img_elem.get('src', '')
                
            # Prime availability
            prime_elem = container.find('span', {'aria-label': 'Amazon Prime'})
            if not prime_elem:
                prime_elem = container.find('i', class_='a-icon-prime')
            product['prime'] = bool(prime_elem)
            
            # Sponsored
            sponsored_elem = container.find('span', string='Sponsored')
            if not sponsored_elem:
                sponsored_elem = container.find('span', class_='puis-sponsored-label-text')
            product['sponsored'] = bool(sponsored_elem)
            
            # Brand extraction
            brand_elem = container.find('span', class_='a-size-base-plus')
            if brand_elem:
                brand_text = brand_elem.get_text(strip=True)
                # Brand is usually the first word or before certain keywords
                brand_words = brand_text.split()
                if brand_words:
                    # Common brand indicators
                    brand_stop_words = ['laptop', 'smartphone', 'mobile', 'phone', 'tablet', 'watch']
                    for word in brand_words:
                        if word.lower() not in brand_stop_words and len(word) > 2:
                            product['brand'] = word
                            break
            
            # Delivery information
            delivery_spans = container.find_all('span', string=lambda text: text and any(
                keyword in text.lower() for keyword in ['delivery', 'tomorrow', 'today', 'free delivery']
            ))
            for span in delivery_spans:
                delivery_text = span.get_text(strip=True)
                if 'delivery' in delivery_text.lower():
                    product['delivery'] = delivery_text
                    break
                    
            # Availability
            availability_spans = container.find_all('span', string=lambda text: text and any(
                keyword in text.lower() for keyword in ['in stock', 'out of stock', 'limited', 'only', 'left']
            ))
            for span in availability_spans:
                availability_text = span.get_text(strip=True)
                if any(keyword in availability_text.lower() for keyword in ['stock', 'left', 'limited']):
                    product['availability'] = availability_text
                    break
            
            # Coupon/Deal information
            coupon_elem = container.find('span', class_='s-coupon-highlight-color')
            if coupon_elem:
                product['coupon'] = coupon_elem.get_text(strip=True)
            
            # Deal/Lightning deal
            deal_spans = container.find_all('span', string=lambda text: text and any(
                keyword in text.lower() for keyword in ['deal', 'lightning', 'limited time', 'today only']
            ))
            for span in deal_spans:
                deal_text = span.get_text(strip=True)
                if 'deal' in deal_text.lower():
                    product['deal_type'] = deal_text
                    break
                    
            # Seller information
            seller_elem = container.find('span', string=lambda text: text and 'by' in text.lower())
            if seller_elem:
                seller_text = seller_elem.get_text(strip=True)
                if 'by' in seller_text.lower():
                    product['seller'] = seller_text
                    
        except Exception as e:
            console.print(f"[red]Error extracting additional details: {str(e)}[/red]")
    
    def extract_review_count(self, container, product):
        """Extract and parse review count with numeric conversion"""
        try:
            # Try multiple selectors for review count
            review_selectors = [
                ('a', 'a-link-normal'),
                ('span', 'a-size-base'),
                ('a', None),  # Any link
            ]
            
            for tag, class_name in review_selectors:
                if class_name:
                    elements = container.find_all(tag, class_=class_name)
                else:
                    elements = container.find_all(tag)
                    
                for elem in elements:
                    text = elem.get_text(strip=True)
                    
                    # Look for patterns like "(1,234)", "1,234 ratings", "1234 reviews"
                    import re
                    
                    # Pattern for numbers in parentheses: (1,234)
                    paren_match = re.search(r'\(([0-9,]+)\)', text)
                    if paren_match:
                        number_text = paren_match.group(1)
                        try:
                            review_count = int(number_text.replace(',', ''))
                            product['reviews_count'] = text  # Keep original format for display
                            product['reviews_count_numeric'] = review_count  # Store numeric for filtering
                            return
                        except:
                            continue
                    
                    # Pattern for "1,234 ratings" or "1,234 reviews"
                    rating_match = re.search(r'([0-9,]+)\s*(rating|review)', text, re.IGNORECASE)
                    if rating_match:
                        number_text = rating_match.group(1)
                        try:
                            review_count = int(number_text.replace(',', ''))
                            product['reviews_count'] = text
                            product['reviews_count_numeric'] = review_count
                            return
                        except:
                            continue
                    
                    # Pattern for just numbers with commas
                    if re.match(r'^[0-9,]+$', text.replace('(', '').replace(')', '')):
                        try:
                            review_count = int(text.replace(',', '').replace('(', '').replace(')', ''))
                            if 1 <= review_count <= 1000000:  # Reasonable range
                                product['reviews_count'] = text
                                product['reviews_count_numeric'] = review_count
                                return
                        except:
                            continue
                            
            # Default values if no reviews found
            product['reviews_count'] = 'N/A'
            product['reviews_count_numeric'] = 0
            
        except Exception as e:
            product['reviews_count'] = 'N/A'
            product['reviews_count_numeric'] = 0
    
    def meets_quality_criteria(self, product, min_rating=4.0, min_reviews=100):
        """Check if product meets quality criteria"""
        try:
            # Check rating
            rating_text = product.get('rating', 'N/A')
            if rating_text == 'N/A':
                return False
                
            try:
                rating = float(rating_text)
                if rating < min_rating:
                    return False
            except:
                return False
            
            # Check review count
            review_count = product.get('reviews_count_numeric', 0)
            if review_count < min_reviews:
                return False
                
            return True
            
        except Exception as e:
            return False

def parse_args():
    parser = argparse.ArgumentParser(description='Amazon Product Scraper with Quality Filters and Tracking')
    
    # Create subparsers for different modes
    subparsers = parser.add_subparsers(dest='mode', help='Operation mode')
    
    # Search mode (default)
    search_parser = subparsers.add_parser('search', help='Search for products')
    search_parser.add_argument('query', help='Search query for products')
    search_parser.add_argument('--pages', type=int, default=3, help='Number of pages to scrape')
    search_parser.add_argument('--domain', default='amazon.in', help='Amazon domain (amazon.in, amazon.com)')
    search_parser.add_argument('--details', action='store_true', help='Get detailed product information')
    search_parser.add_argument('--output', default='amazon_products', help='Output file prefix')
    search_parser.add_argument('--min-rating', type=float, default=4.0, help='Minimum rating (default: 4.0)')
    search_parser.add_argument('--min-reviews', type=int, default=100, help='Minimum number of reviews (default: 100)')
    search_parser.add_argument('--no-filters', action='store_true', help='Disable rating and review filters')
    search_parser.add_argument('--track', action='store_true', help='Add results to tracking list')
    search_parser.add_argument('--target-price', type=float, help='Target price for tracking alerts')
    
    # Track mode
    track_parser = subparsers.add_parser('track', help='Manage product tracking')
    track_subparsers = track_parser.add_subparsers(dest='track_action', help='Tracking action')
    
    # Track list
    list_parser = track_subparsers.add_parser('list', help='List tracked products')
    
    # Track add
    add_parser = track_subparsers.add_parser('add', help='Add product to tracking by URL')
    add_parser.add_argument('url', help='Amazon product URL')
    add_parser.add_argument('--target-price', type=float, help='Target price for alerts')
    add_parser.add_argument('--notes', help='Notes about this product')
    
    # Track remove
    remove_parser = track_subparsers.add_parser('remove', help='Remove product from tracking')
    remove_parser.add_argument('product_id', type=int, help='Product ID to remove')
    
    # Track update
    update_parser = track_subparsers.add_parser('update', help='Update prices for all tracked products')
    update_parser.add_argument('--domain', default='amazon.in', help='Amazon domain (amazon.in, amazon.com)')
    
    # For backward compatibility, if no subcommand is provided, treat first arg as search query
    args = parser.parse_args()
    
    # If no mode specified, assume search mode with first argument as query
    if args.mode is None:
        # Reconstruct args as if it was a search command
        import sys
        if len(sys.argv) > 1:
            # Create a namespace with search defaults
            search_args = argparse.Namespace(
                mode='search',
                query=sys.argv[1],
                pages=3,
                domain='amazon.in',
                details=False,
                output='amazon_products',
                min_rating=4.0,
                min_reviews=100,
                no_filters=False,
                track=False,
                target_price=None
            )
            
            # Parse additional arguments
            remaining_args = sys.argv[2:]
            search_parser.parse_args(remaining_args, namespace=search_args)
            return search_args
    
    return args

def main():
    try:
        console.print("[cyan]Amazon Product Scraper with Tracking[/cyan]")
        start_time = datetime.now()
        
        # Parse command line arguments
        args = parse_args()
        
        # Initialize tracker
        tracker = ProductTracker()
        
        # Handle different modes
        if args.mode == 'track':
            handle_tracking_mode(args, tracker)
        else:
            handle_search_mode(args, tracker)
            
    except KeyboardInterrupt:
        console.print("\n[yellow]Operation interrupted by user[/yellow]")
    except Exception as e:
        console.print(f"[red]Error: {str(e)}[/red]")
        console.print_exception()

def handle_tracking_mode(args, tracker):
    """Handle tracking-related commands"""
    if args.track_action == 'list':
        tracker.list_tracked_products()
        
    elif args.track_action == 'add':
        scraper = AmazonScraper()
        console.print(f"[yellow]Adding product from URL...[/yellow]")
        product_data = scraper.get_product_from_url(args.url)
        
        if product_data:
            tracker.add_product(product_data, args.target_price, args.notes)
        else:
            console.print("[red]Failed to fetch product data from URL[/red]")
            
    elif args.track_action == 'remove':
        tracker.remove_product(args.product_id)
        
    elif args.track_action == 'update':
        scraper = AmazonScraper(domain=args.domain)
        tracker.update_prices(scraper)
        
    else:
        console.print("[yellow]Available tracking commands:[/yellow]")
        console.print("  track list                    - List tracked products")
        console.print("  track add <url>              - Add product by URL")
        console.print("  track remove <id>            - Remove product by ID")
        console.print("  track update                 - Update all prices")

def handle_search_mode(args, tracker):
    """Handle search mode with optional tracking"""
    start_time = datetime.now()
    scraper = AmazonScraper(domain=args.domain)
    
    # Search for products with quality filters
    if args.no_filters:
        console.print(f"[yellow]Searching for '{args.query}' on {args.domain} (no filters)...[/yellow]")
        products = scraper.search_products(args.query, max_pages=args.pages, apply_filters=False)
    else:
        console.print(f"[yellow]Searching for '{args.query}' on {args.domain} (Rating: {args.min_rating}+, Reviews: {args.min_reviews}+)...[/yellow]")
        products = scraper.search_products(args.query, max_pages=args.pages, 
                                         min_rating=args.min_rating, 
                                         min_reviews=args.min_reviews, 
                                         apply_filters=True)
    
    if products:
        # Display results
        scraper.display_results(products, f"Search Results for '{args.query}'")
        
        # Get detailed info if requested
        if args.details and products:
            console.print("[yellow]Getting detailed product information...[/yellow]")
            for i, product in enumerate(products[:5]):  # Get details for top 5
                if product.get('url'):
                    details = scraper.get_product_details(product['url'])
                    products[i].update(details)
                    
        # Analyze prices and discounts
        analysis = scraper.analyze_prices(products)
        discount_analysis = scraper.analyze_discounts(products)
        
        if analysis:
            console.print("\n[cyan]Price Analysis:[/cyan]")
            console.print(f"Total Products: {analysis['total_products']}")
            console.print(f"Price Range: ₹{analysis['min_price']:,.0f} - ₹{analysis['max_price']:,.0f}")
            console.print(f"Average Price: ₹{analysis['avg_price']:,.0f}")
            console.print(f"Under ₹10k: {analysis['price_range_10k']} products")
            console.print(f"₹10k-₹50k: {analysis['price_range_50k']} products")
            console.print(f"Above ₹50k: {analysis['price_range_above_50k']} products")
            
        if discount_analysis:
            console.print("\n[cyan]Discount Analysis:[/cyan]")
            console.print(f"Products with Discounts: {discount_analysis['discounted_products']}")
            console.print(f"Average Discount: {discount_analysis['avg_discount']:.1f}%")
            console.print(f"Highest Discount: {discount_analysis['max_discount']:.0f}%")
            console.print(f"Total Savings Available: ₹{discount_analysis['total_savings']:,.0f}")
        
        # Add to tracking if requested
        if args.track:
            console.print(f"\n[yellow]Adding {len(products)} products to tracking list...[/yellow]")
            for product in products:
                if product.get('url'):
                    tracker.add_product(product, args.target_price)
        
        # Save results
        scraper.save_results(products, args.output)
        
        # Print execution summary
        end_time = datetime.now()
        duration = end_time - start_time
        console.print(f"\n[cyan]Execution time: {duration.total_seconds():.2f} seconds[/cyan]")
        console.print(f"[green]Scraped {len(products)} products successfully![/green]")
        
    else:
        console.print("[red]No products found![/red]")

if __name__ == "__main__":
    main()
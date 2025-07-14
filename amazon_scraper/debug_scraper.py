import requests
from bs4 import BeautifulSoup
import rookiepy

# Quick debug script to see what we're getting from Amazon
def debug_amazon():
    try:
        # Get cookies
        cookies = rookiepy.to_cookiejar(rookiepy.chrome(['.amazon.in']))
        print("✓ Got cookies")
    except:
        cookies = None
        print("✗ No cookies")
    
    session = requests.Session()
    if cookies:
        session.cookies = cookies
    
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    })
    
    url = "https://www.amazon.in/s?k=laptop"
    response = session.get(url)
    
    print(f"Status: {response.status_code}")
    print(f"URL: {response.url}")
    
    soup = BeautifulSoup(response.content, 'html.parser')
    print(f"Title: {soup.title.string if soup.title else 'No title'}")
    
    # Check for common indicators
    if 'captcha' in response.text.lower():
        print("⚠️  CAPTCHA detected")
    if 'robot' in response.text.lower():
        print("⚠️  Robot check detected")
        
    # Try different selectors
    selectors = [
        ('data-component-type', 's-search-result'),
        ('class', 's-result-item'),
        ('data-asin', True),
        ('class', 'sg-col-inner')
    ]
    
    for selector_type, selector_value in selectors:
        if selector_type == 'data-asin':
            elements = soup.find_all('div', attrs={'data-asin': True})
        elif selector_type == 'data-component-type':
            elements = soup.find_all('div', {selector_type: selector_value})
        else:
            elements = soup.find_all('div', class_=selector_value)
            
        print(f"Selector {selector_type}={selector_value}: Found {len(elements)} elements")
        
        if elements:
            # Check first element
            first = elements[0]
            h2_tags = first.find_all('h2')
            print(f"  First element has {len(h2_tags)} h2 tags")
            a_tags = first.find_all('a')
            print(f"  First element has {len(a_tags)} a tags")
            
            # Look for any text that might be a product title
            spans = first.find_all('span')
            for span in spans[:3]:  # Check first 3 spans
                text = span.get_text(strip=True)
                if len(text) > 20:
                    print(f"  Potential title: {text[:50]}...")
                    break

if __name__ == "__main__":
    debug_amazon()
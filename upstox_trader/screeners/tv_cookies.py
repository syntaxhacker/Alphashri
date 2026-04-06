import rookiepy


def get_tradingview_cookies():
    """Get TradingView cookies from browser"""
    try:
        cookies_raw = rookiepy.chrome(['.tradingview.com'])
        cookies = rookiepy.to_cookiejar(cookies_raw)
        
        if cookies_raw:
            pass
        
        return cookies
    except Exception:
        try:
            cookies_raw = rookiepy.firefox(['.tradingview.com'])
            cookies = rookiepy.to_cookiejar(cookies_raw)
            
            if cookies_raw:
                pass
            
            return cookies
        except Exception:
            return None

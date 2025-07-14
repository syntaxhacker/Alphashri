#!/usr/bin/env python3
"""
Sensibull Portfolio Detail Parser
================================

Detailed parser to extract complete portfolio information from Sensibull's
rendered HTML content. This builds on the successful Selenium scraper to 
provide structured data about portfolios, strategies, and positions.

Based on the successful extraction showing:
- yolo: +₹26,850 (1 Strategy)
- iron: +₹11,025 (1 Strategy)  
- new: +₹3,272 (1 Strategy)
- Total: +₹41,148

Usage:
    python sensibull_portfolio_parser.py
"""

import re
import json
import logging
from datetime import datetime
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict
from pathlib import Path

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('SensibullParser')

@dataclass
class PortfolioStrategy:
    """Individual strategy within a portfolio"""
    name: str
    pnl: float
    pnl_percent: Optional[float] = None
    positions_count: int = 0
    entry_date: Optional[str] = None
    status: str = "active"

@dataclass  
class PortfolioPosition:
    """Individual position within a strategy"""
    symbol: str
    instrument_type: str  # CE, PE, FUT, EQ
    strike: Optional[float] = None
    expiry: Optional[str] = None
    quantity: int = 0
    entry_price: float = 0.0
    current_price: float = 0.0
    pnl: float = 0.0
    pnl_percent: float = 0.0

@dataclass
class Portfolio:
    """Complete portfolio with all details"""
    name: str
    total_pnl: float
    unrealized_pnl: float
    realized_pnl: float
    strategies: List[PortfolioStrategy]
    total_strategies: int
    last_updated: str
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'name': self.name,
            'total_pnl': self.total_pnl,
            'unrealized_pnl': self.unrealized_pnl,
            'realized_pnl': self.realized_pnl,
            'strategies': [asdict(s) for s in self.strategies],
            'total_strategies': self.total_strategies,
            'last_updated': self.last_updated
        }

class SensibullPortfolioParser:
    """Parse detailed portfolio information from Sensibull HTML/text content"""
    
    def __init__(self):
        self.portfolios = []
        self.raw_data = {}
        
    def load_scraped_content(self, 
                           html_file: str = "sensibull_rendered_content.html",
                           screenshot_file: str = "sensibull_screenshot.png") -> bool:
        """Load the scraped content from files"""
        try:
            # Load HTML content
            html_path = Path(html_file)
            if html_path.exists():
                with open(html_path, 'r', encoding='utf-8') as f:
                    self.raw_data['html'] = f.read()
                logger.info(f"✅ Loaded HTML content: {len(self.raw_data['html'])} chars")
            else:
                logger.error(f"❌ HTML file not found: {html_file}")
                return False
                
            # Note screenshot file
            screenshot_path = Path(screenshot_file)
            if screenshot_path.exists():
                logger.info(f"✅ Screenshot available: {screenshot_file}")
                self.raw_data['screenshot'] = screenshot_file
            else:
                logger.warning(f"⚠️ Screenshot not found: {screenshot_file}")
                
            return True
            
        except Exception as e:
            logger.error(f"❌ Error loading scraped content: {e}")
            return False
    
    def extract_text_from_html(self) -> str:
        """Extract readable text from HTML using regex patterns"""
        html = self.raw_data.get('html', '')
        
        # Remove script and style content
        html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL | re.IGNORECASE)
        html = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL | re.IGNORECASE)
        
        # Remove HTML tags but keep content
        text = re.sub(r'<[^>]+>', ' ', html)
        
        # Clean up whitespace
        text = re.sub(r'\s+', ' ', text).strip()
        
        return text
    
    def parse_portfolio_summary(self, text: str) -> Dict[str, Any]:
        """Parse the portfolio summary section"""
        summary = {
            'total_portfolios': 0,
            'total_pnl': 0.0,
            'unrealized_pnl': 0.0,
            'realized_pnl': 0.0
        }
        
        # Look for "3 of 3 Portfolios" pattern
        portfolio_count_match = re.search(r'(\d+)\s+of\s+(\d+)\s+Portfolios?', text, re.IGNORECASE)
        if portfolio_count_match:
            summary['total_portfolios'] = int(portfolio_count_match.group(1))
            logger.info(f"📊 Found {summary['total_portfolios']} portfolios")
        
        # Look for P&L values - pattern: "Total P&L +41,148 Unrealised P&L +41,148 Realised P&L 0"
        pnl_patterns = [
            r'Total\s+P[&/]L\s*[^\d]*([+-]?\d{1,3}(?:,\d{3})*)',
            r'Unrealised?\s+P[&/]L\s*[^\d]*([+-]?\d{1,3}(?:,\d{3})*)',
            r'Realised?\s+P[&/]L\s*[^\d]*([+-]?\d{1,3}(?:,\d{3})*)'
        ]
        
        pnl_keys = ['total_pnl', 'unrealized_pnl', 'realized_pnl']
        
        for i, pattern in enumerate(pnl_patterns):
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                # Convert comma-separated number to float
                value_str = match.group(1).replace(',', '')
                summary[pnl_keys[i]] = float(value_str)
                logger.info(f"💰 {pnl_keys[i]}: ₹{summary[pnl_keys[i]]:,.2f}")
        
        return summary
    
    def parse_individual_portfolios(self, text: str) -> List[Portfolio]:
        """Parse individual portfolio details"""
        portfolios = []
        
        # Pattern to match portfolio rows from the table
        # Looking for: "yolo +26,850 +26,850 0 1 Strategy"
        portfolio_pattern = r'([a-zA-Z][a-zA-Z0-9_]*)\s+([+-]?\d{1,3}(?:,\d{3})*)\s+([+-]?\d{1,3}(?:,\d{3})*)\s+([+-]?\d{1,3}(?:,\d{3})*)\s+(\d+)\s+Strateg(?:y|ies)'
        
        matches = re.findall(portfolio_pattern, text)
        
        for match in matches:
            name = match[0]
            total_pnl = float(match[1].replace(',', ''))
            unrealized_pnl = float(match[2].replace(',', ''))
            realized_pnl = float(match[3].replace(',', ''))
            strategy_count = int(match[4])
            
            # Create basic strategy placeholder
            strategies = []
            for i in range(strategy_count):
                strategy = PortfolioStrategy(
                    name=f"{name}_strategy_{i+1}",
                    pnl=total_pnl / strategy_count,  # Distribute P&L evenly
                    positions_count=0
                )
                strategies.append(strategy)
            
            portfolio = Portfolio(
                name=name,
                total_pnl=total_pnl,
                unrealized_pnl=unrealized_pnl,
                realized_pnl=realized_pnl,
                strategies=strategies,
                total_strategies=strategy_count,
                last_updated=datetime.now().isoformat()
            )
            
            portfolios.append(portfolio)
            logger.info(f"📋 Parsed portfolio '{name}': ₹{total_pnl:,.2f} P&L, {strategy_count} strategies")
        
        return portfolios
    
    def extract_option_positions(self, text: str) -> List[PortfolioPosition]:
        """Extract options positions from text content"""
        positions = []
        
        # Common option patterns
        option_patterns = [
            r'(NIFTY|BANKNIFTY|SENSEX)\s+(\d{1,2}[A-Z]{3}\d{2,4})\s+(\d+)\s+(CE|PE)',
            r'(NIFTY|BANKNIFTY)\s+(\d+)\s+(CE|PE)\s+@\s*₹?(\d+(?:\.\d+)?)',
            r'Strike[:\s]+(\d+)\s+Expiry[:\s]+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})'
        ]
        
        for pattern in option_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            for match in matches:
                try:
                    if len(match) >= 4:
                        position = PortfolioPosition(
                            symbol=match[0],
                            instrument_type=match[3] if len(match) > 3 else "OPTION",
                            strike=float(match[2]) if match[2].isdigit() else None,
                            expiry=match[1] if not match[1].isdigit() else None
                        )
                        positions.append(position)
                        
                except (ValueError, IndexError) as e:
                    logger.debug(f"⚠️ Could not parse position: {match}, error: {e}")
        
        return positions
    
    def parse_complete_data(self) -> Dict[str, Any]:
        """Parse all available data from the scraped content"""
        if not self.raw_data.get('html'):
            logger.error("❌ No HTML content available to parse")
            return {}
        
        logger.info("🔍 PARSING COMPLETE PORTFOLIO DATA")
        logger.info("=" * 50)
        
        # Extract text from HTML
        text = self.extract_text_from_html()
        logger.info(f"📝 Extracted {len(text)} characters of readable text")
        
        # Parse portfolio summary
        summary = self.parse_portfolio_summary(text)
        
        # Parse individual portfolios  
        portfolios = self.parse_individual_portfolios(text)
        self.portfolios = portfolios
        
        # Extract positions (if any detailed data available)
        positions = self.extract_option_positions(text)
        
        # Compile results
        results = {
            'timestamp': datetime.now().isoformat(),
            'summary': summary,
            'portfolios': [p.to_dict() for p in portfolios],
            'total_portfolios_found': len(portfolios),
            'positions_found': len(positions),
            'raw_text_length': len(text)
        }
        
        # Log results
        logger.info("📊 PARSING RESULTS:")
        logger.info(f"   Total Portfolios: {len(portfolios)}")
        logger.info(f"   Total P&L: ₹{summary.get('total_pnl', 0):,.2f}")
        logger.info(f"   Positions Found: {len(positions)}")
        
        for portfolio in portfolios:
            logger.info(f"   └─ {portfolio.name}: ₹{portfolio.total_pnl:,.2f} ({portfolio.total_strategies} strategies)")
        
        return results
    
    def save_parsed_data(self, results: Dict[str, Any], filename: str = "sensibull_parsed_portfolios.json"):
        """Save parsed data to JSON file"""
        try:
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(results, f, indent=2, ensure_ascii=False)
            logger.info(f"💾 Saved parsed data to: {filename}")
            return True
        except Exception as e:
            logger.error(f"❌ Error saving parsed data: {e}")
            return False
    
    def get_portfolio_by_name(self, name: str) -> Optional[Portfolio]:
        """Get a specific portfolio by name"""
        for portfolio in self.portfolios:
            if portfolio.name.lower() == name.lower():
                return portfolio
        return None
    
    def get_total_pnl(self) -> float:
        """Get total P&L across all portfolios"""
        return sum(p.total_pnl for p in self.portfolios)

def main():
    """Main function to run the portfolio parser"""
    print("""
🔥 SENSIBULL PORTFOLIO DETAIL PARSER
===================================

This script parses the scraped Sensibull data to extract:
✅ Individual portfolio details (yolo, iron, new)
✅ P&L breakdown (total, unrealized, realized)
✅ Strategy counts and details
✅ Position information (when available)

Requirements:
- sensibull_rendered_content.html (from Selenium scraper)
- sensibull_screenshot.png (for reference)

Starting parser...
    """)
    
    # Initialize parser
    parser = SensibullPortfolioParser()
    
    # Load scraped content
    if not parser.load_scraped_content():
        print("❌ Failed to load scraped content")
        print("💡 Make sure to run sensibull_selenium_scraper.py first")
        return
    
    # Parse the data
    results = parser.parse_complete_data()
    
    if not results:
        print("❌ Failed to parse portfolio data")
        return
    
    # Save results
    parser.save_parsed_data(results)
    
    # Display summary
    print("\n" + "=" * 50)
    print("🏁 PARSING COMPLETE")
    print("=" * 50)
    
    print(f"📊 Found {results['total_portfolios_found']} portfolios:")
    
    for portfolio_data in results['portfolios']:
        name = portfolio_data['name']
        pnl = portfolio_data['total_pnl']
        strategies = portfolio_data['total_strategies']
        print(f"   └─ {name}: ₹{pnl:,.2f} ({strategies} strategies)")
    
    total_pnl = sum(p['total_pnl'] for p in results['portfolios'])
    print(f"\n💰 Total Portfolio P&L: ₹{total_pnl:,.2f}")
    
    print(f"\n📁 Results saved to: sensibull_parsed_portfolios.json")
    print("🔗 Ready for integration with Upstox signal forwarding!")

if __name__ == "__main__":
    main()
import re
from datetime import datetime
from typing import List, Dict, Any

def parse_log_file(file_path: str) -> List[Dict[str, Any]]:
    """
    Parse the log file and extract trade data.
    
    Args:
        file_path: Path to the log file
        
    Returns:
        List of raw trade dictionaries
    """
    trades = []
    
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            lines = file.readlines()
            
        # Skip header lines (starting with #)
        data_lines = [line.strip() for line in lines if not line.strip().startswith('#') and line.strip()]
        
        for line in data_lines:
            parts = line.split(' | ')
            
            if len(parts) >= 7:
                trade = parse_trade_line(parts)
                if trade:
                    trades.append(trade)
                    
    except FileNotFoundError:
        print(f"Error: Log file not found at {file_path}")
    except Exception as e:
        print(f"Error parsing log file: {e}")
    
    return trades

def parse_trade_line(parts: List[str]) -> Dict[str, Any]:
    """
    Parse a single trade line from the log.
    
    Args:
        parts: List of parts from the log line split by ' | '
        
    Returns:
        Dictionary containing parsed trade data
    """
    try:
        timestamp = datetime.strptime(parts[0].strip(), '%Y-%m-%d %H:%M:%S')
        action = parts[1].strip()
        symbol = parts[2].strip()
        price = float(parts[3].replace('₹', '').strip())
        qty = int(parts[4].strip())
        amount = float(parts[5].replace('₹', '').replace(',', '').strip())
        
        # For EXIT trades, the alertType and P&L are in separate parts
        # For ENTRY trades, there's only one part after the first 6
        if action == 'EXIT':
            # Combine parts from index 6 to second-to-last for alertType
            alert_type = ' | '.join(parts[6:-1]).strip()
            # Parse P&L from the last part
            pl_text = parts[-1].strip()
        else:
            # ENTRY trades have only one part after the first 6
            alert_type = parts[6].strip()
            pl_text = ''
        
        # Parse P&L information
        pl_amount, pl_percent = parse_pl_info(pl_text)
        
        return {
            'timestamp': timestamp,
            'action': action,
            'symbol': symbol,
            'price': price,
            'qty': qty,
            'amount': amount,
            'alert_type': alert_type,
            'pl_amount': pl_amount,
            'pl_percent': pl_percent,
            'pl_class': 'positive' if pl_amount >= 0 else 'negative',
            'pl_symbol': '+' if pl_amount >= 0 else ''
        }
        
    except (ValueError, IndexError) as e:
        print(f"Error parsing trade line: {e}")
        return None

def parse_pl_info(pl_text: str) -> tuple:
    """
    Parse P&L percentage and amount from P&L text.
    
    Args:
        pl_text: Text containing P&L information
        
    Returns:
        Tuple of (pl_amount, pl_percent)
    """
    pl_amount = 0.0
    pl_percent = 0.0
    
    if 'P&L:' in pl_text:
        # Regex pattern to match P&L format: "P&L: -0.59% (₹-117)"
        pattern = r'P&L:\s*([+-]?\d+(?:\.\d+)?)%?\s*(?:\((₹[+-]?\d+(?:,\d+)?(?:\.\d+)?)\))?'
        match = re.search(pattern, pl_text)
        
        if match:
            pl_percent = float(match.group(1))
            if match.group(2):
                pl_amount = float(match.group(2).replace('₹', '').replace(',', ''))
            else:
                # Calculate P&L amount if not provided
                # This would need the price and qty from the trade
                pass
    
    return pl_amount, pl_percent
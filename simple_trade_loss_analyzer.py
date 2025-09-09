#!/usr/bin/env python3
"""
Simple Trade Loss Analyzer
Focus on analyzing the actual trade data to determine why it lost money
"""

import json
import os
import sys
import pandas as pd
from datetime import datetime, timedelta
from openai import OpenAI
from typing import Dict, List, Optional

class SimpleTradeAnalyzer:
    """Simple analyzer focused on actual trade analysis"""
    
    def __init__(self):
        # Use the test API key
        api_key = "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"
        self.client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key
        )
    
    def analyze_trade(self, trade_data: Dict) -> Dict:
        """Analyze losing trade with simple, focused approach"""
        print(f"🔍 Starting analysis for {trade_data['symbol']} trade")
        
        # Create trade analysis prompt
        trade_summary = self._format_trade_for_analysis(trade_data)
        
        # Get analysis from 3 different perspectives
        analyses = {}
        
        # Technical Analysis
        print("  📊 Technical Analysis...")
        analyses['technical'] = self._get_technical_analysis(trade_summary)
        
        # Risk Management Analysis  
        print("  ⚖️ Risk Management Analysis...")
        analyses['risk'] = self._get_risk_analysis(trade_summary)
        
        # Market Timing Analysis
        print("  🕐 Market Timing Analysis...")
        analyses['timing'] = self._get_timing_analysis(trade_summary)
        
        # Judge Expert Synthesis
        print("  ⚖️ Judge Expert Synthesis...")
        analyses['judge'] = self._get_judge_synthesis(trade_summary, analyses)
        
        return {
            'trade_data': trade_data,
            'analyses': analyses,
            'analyzed_at': datetime.now().isoformat()
        }
    
    def _format_trade_for_analysis(self, trade: Dict) -> str:
        """Format trade data for analysis"""
        return f"""
TRADE DETAILS:
Symbol: {trade['symbol']}
Entry Time: {trade['entry_time']}
Exit Time: {trade['exit_time']}  
Entry Price: ₹{trade['entry_price']}
Exit Price: ₹{trade['exit_price']}
Quantity: {trade['quantity']}
Hold Duration: {trade['hold_time']} ({trade['hold_time_minutes']} minutes)
P&L: ₹{trade['pnl_amount']} ({trade['pnl_percentage']}%)
Exit Reason: {trade['exit_reason']}
Trade Side: {trade['side']} (Entry was {trade['side']})

LOSS ANALYSIS NEEDED:
This trade lost ₹{abs(trade['pnl_amount'])} in just {trade['hold_time_minutes']} minutes.
The exit reason was: {trade['exit_reason']}
"""
    
    def _get_technical_analysis(self, trade_summary: str) -> str:
        """Get technical analysis of why trade failed"""
        prompt = f"""You are a technical analyst. Analyze this losing trade from a technical perspective.

{trade_summary}

Focus on:
1. Was the entry price good or bad technically?
2. What does the 3-minute hold time tell us?
3. Why did the trailing stop trigger so quickly?
4. What technical mistakes were made?
5. What should have been done differently?

Be specific and actionable in your analysis. Don't ask for more data - analyze what's provided."""
        
        try:
            response = self.client.chat.completions.create(
                model="mistralai/mistral-small-3.2-24b-instruct:free",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=500
            )
            return response.choices[0].message.content
        except Exception as e:
            return f"Technical analysis failed: {e}"
    
    def _get_risk_analysis(self, trade_summary: str) -> str:
        """Get risk management analysis"""
        prompt = f"""You are a risk management expert. Analyze this losing trade from a risk perspective.

{trade_summary}

Focus on:
1. Was the position size appropriate?
2. Was the stop loss too tight or too loose?
3. What does a -0.25% loss in 3 minutes indicate about risk management?
4. How could risk have been managed better?
5. What risk management rules were broken?

Be specific about risk management mistakes and improvements."""
        
        try:
            response = self.client.chat.completions.create(
                model="mistralai/mistral-small-3.2-24b-instruct:free",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=500
            )
            return response.choices[0].message.content
        except Exception as e:
            return f"Risk analysis failed: {e}"
    
    def _get_timing_analysis(self, trade_summary: str) -> str:
        """Get market timing analysis"""
        prompt = f"""You are a market timing expert. Analyze this losing trade from a timing perspective.

{trade_summary}

Focus on:
1. Was 09:20:19 a good entry time? (Market opens at 09:15)
2. What does entering just 5 minutes after market open suggest?
3. Why did the trade fail in just 3 minutes?
4. What does this timing pattern indicate about the strategy?
5. How should entry timing be improved?

Analyze the timing aspects that contributed to this loss."""
        
        try:
            response = self.client.chat.completions.create(
                model="mistralai/mistral-small-3.2-24b-instruct:free",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=500
            )
            return response.choices[0].message.content
        except Exception as e:
            return f"Timing analysis failed: {e}"
    
    def _get_judge_synthesis(self, trade_summary: str, analyses: Dict) -> str:
        """Judge expert synthesizes all findings"""
        prompt = f"""You are a Master Trading Judge. Synthesize the following analyses to determine the PRIMARY cause of this trade loss.

TRADE:
{trade_summary}

TECHNICAL ANALYSIS:
{analyses['technical']}

RISK ANALYSIS: 
{analyses['risk']}

TIMING ANALYSIS:
{analyses['timing']}

Provide:
1. PRIMARY CAUSE: What was the #1 reason this trade lost money?
2. SECONDARY FACTORS: What else contributed (ranked by importance)?
3. LESSONS LEARNED: Key takeaways
4. SPECIFIC IMPROVEMENTS: Exactly what to do differently next time

Be decisive and actionable in your verdict."""
        
        try:
            response = self.client.chat.completions.create(
                model="mistralai/mistral-small-3.2-24b-instruct:free",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=600
            )
            return response.choices[0].message.content
        except Exception as e:
            return f"Judge synthesis failed: {e}"

class LogTradeParser:
    """Parser for trading log files"""
    
    def parse_log_file(self, log_file_path: str) -> List[Dict]:
        """Parse log file and extract losing trades"""
        try:
            with open(log_file_path, 'r') as f:
                lines = f.readlines()
            
            trades = []
            losing_trades = []
            entries = {}
            
            for line_num, line in enumerate(lines, 1):
                line = line.strip()
                if line.startswith('#') or line.startswith('-') or not line:
                    continue
                
                trade_data = self._parse_trade_line(line, line_num)
                if not trade_data:
                    continue
                
                if trade_data['action'] == 'ENTRY':
                    key = f"{trade_data['symbol']}_{trade_data['side']}"
                    entries[key] = trade_data
                
                elif trade_data['action'] == 'EXIT':
                    entry_side = 'BUY' if trade_data['side'] == 'SELL' else 'SELL'
                    key = f"{trade_data['symbol']}_{entry_side}"
                    
                    if key in entries:
                        entry_data = entries[key]
                        complete_trade = self._create_complete_trade(entry_data, trade_data)
                        trades.append(complete_trade)
                        
                        if complete_trade.get('pnl_amount') and complete_trade['pnl_amount'] < 0:
                            losing_trades.append(complete_trade)
                        
                        del entries[key]
            
            return losing_trades
            
        except Exception as e:
            print(f"Error parsing log file: {e}")
            return []
    
    def _parse_trade_line(self, line: str, line_num: int) -> Optional[Dict]:
        """Parse individual trade line"""
        try:
            parts = [part.strip() for part in line.split('|')]
            if len(parts) < 6:
                return None
            
            timestamp = parts[0]
            action_side = parts[1]
            symbol = parts[2].replace('NSE:', '').replace('BSE:', '')
            price_str = parts[3].replace('₹', '').replace(',', '')
            quantity = int(parts[4])
            
            if action_side.startswith('ENTRY_'):
                action = 'ENTRY'
                side = action_side.replace('ENTRY_', '')
            elif action_side.startswith('EXIT_'):
                action = 'EXIT'
                side = action_side.replace('EXIT_', '')
            else:
                return None
            
            pnl_percentage = None
            pnl_amount = None
            exit_reason = None
            
            if action == 'EXIT' and len(parts) >= 7:
                exit_info = parts[6]
                exit_reason = exit_info
                
                # Extract P&L from line
                import re
                full_line = ' | '.join(parts[6:])
                pnl_match = re.search(r'P&L: ([+-]?\d+\.?\d*)% \(₹?([+-]?\d+)', full_line)
                if pnl_match:
                    pnl_percentage = float(pnl_match.group(1))
                    pnl_amount = float(pnl_match.group(2))
            
            return {
                'timestamp': timestamp,
                'action': action,
                'side': side,
                'symbol': symbol,
                'price': float(price_str),
                'quantity': quantity,
                'exit_reason': exit_reason,
                'pnl_percentage': pnl_percentage,
                'pnl_amount': pnl_amount,
                'line_num': line_num
            }
            
        except Exception as e:
            return None
    
    def _create_complete_trade(self, entry: Dict, exit: Dict) -> Dict:
        """Create complete trade from entry and exit"""
        from datetime import datetime
        entry_time = datetime.strptime(entry['timestamp'], '%Y-%m-%d %H:%M:%S')
        exit_time = datetime.strptime(exit['timestamp'], '%Y-%m-%d %H:%M:%S')
        hold_duration = exit_time - entry_time
        hold_minutes = int(hold_duration.total_seconds() / 60)
        
        return {
            'symbol': entry['symbol'],
            'entry_time': entry['timestamp'],
            'exit_time': exit['timestamp'],
            'entry_price': entry['price'],
            'exit_price': exit['price'],
            'quantity': entry['quantity'],
            'side': entry['side'],
            'pnl_percentage': exit['pnl_percentage'],
            'pnl_amount': exit['pnl_amount'],
            'hold_time_minutes': hold_minutes,
            'hold_time': f"{hold_minutes}m",
            'exit_reason': exit['exit_reason'],
            'trade_date': entry['timestamp'].split(' ')[0]
        }

def display_analysis(analysis_result: Dict):
    """Display analysis in readable format"""
    trade = analysis_result["trade_data"]
    
    print("\n" + "=" * 80)
    print(f"🎯 TRADE LOSS ANALYSIS: {trade['symbol']}")
    print("=" * 80)
    
    print(f"\n📊 TRADE DETAILS:")
    print(f"   Entry: {trade['entry_time']} at ₹{trade['entry_price']}")
    print(f"   Exit:  {trade['exit_time']} at ₹{trade['exit_price']}")
    print(f"   Duration: {trade['hold_time']} ({trade['hold_time_minutes']} minutes)")
    print(f"   P&L: ₹{trade['pnl_amount']} ({trade['pnl_percentage']}%)")
    print(f"   Exit Reason: {trade['exit_reason']}")
    
    analyses = analysis_result["analyses"]
    
    print(f"\n" + "=" * 80)
    print("📊 TECHNICAL ANALYSIS")
    print("=" * 80)
    print(analyses['technical'])
    
    print(f"\n" + "=" * 80)
    print("⚖️ RISK MANAGEMENT ANALYSIS")
    print("=" * 80)
    print(analyses['risk'])
    
    print(f"\n" + "=" * 80)
    print("🕐 MARKET TIMING ANALYSIS")
    print("=" * 80)
    print(analyses['timing'])
    
    print(f"\n" + "=" * 80)
    print("⚖️ JUDGE EXPERT FINAL VERDICT")
    print("=" * 80)
    print(analyses['judge'])
    
    print("\n" + "=" * 80)

def main():
    """Main function"""
    if len(sys.argv) < 2:
        print("Usage: python simple_trade_loss_analyzer.py <log_file.log> [trade_index]")
        return
    
    log_file = sys.argv[1]
    trade_index = int(sys.argv[2]) if len(sys.argv) > 2 else None
    
    if not os.path.exists(log_file):
        print(f"❌ Log file not found: {log_file}")
        return
    
    print(f"📖 Parsing trading log: {os.path.basename(log_file)}")
    
    parser = LogTradeParser()
    losing_trades = parser.parse_log_file(log_file)
    
    if not losing_trades:
        print("✅ No losing trades found!")
        return
    
    print(f"📊 Found {len(losing_trades)} losing trades")
    
    # Show available trades
    print("\n📋 Available losing trades:")
    for i, trade in enumerate(losing_trades):
        print(f"  {i+1}. {trade['symbol']} - {trade['entry_time']} - P&L: ₹{trade['pnl_amount']:.0f} ({trade['pnl_percentage']:.2f}%)")
    
    # Select trade
    if trade_index is None:
        try:
            trade_index = int(input(f"\nSelect trade to analyze (1-{len(losing_trades)}): "))
        except (ValueError, KeyboardInterrupt):
            print("❌ Invalid selection")
            return
    
    if trade_index < 1 or trade_index > len(losing_trades):
        print("❌ Invalid trade index")
        return
    
    selected_trade = losing_trades[trade_index - 1]
    print(f"\n🎯 Analyzing: {selected_trade['symbol']} - P&L: ₹{selected_trade['pnl_amount']:.0f}")
    
    # Analyze trade
    analyzer = SimpleTradeAnalyzer()
    analysis_result = analyzer.analyze_trade(selected_trade)
    
    # Display results
    display_analysis(analysis_result)
    
    # Save results
    output_file = f"simple_loss_analysis_{selected_trade['symbol']}_{selected_trade['trade_date'].replace('-', '')}.json"
    with open(output_file, 'w') as f:
        json.dump(analysis_result, f, indent=2)
    
    print(f"\n📄 Full analysis saved to: {output_file}")

if __name__ == "__main__":
    main()
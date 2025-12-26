#!/usr/bin/env python3
"""
Trade Loss Analyzer Agents
Multi-agent system with function calling to analyze losing trades like humans would.
Uses 3 specialist agents + 1 judge expert for comprehensive analysis.
"""

import json
import os
import sys
import pandas as pd
from datetime import datetime, timedelta
from openai import OpenAI
from typing import Dict, List, Optional, Any
import requests
import time

# Add project paths
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'upstox_trader'))

# Import Upstox API if available
try:
    from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI
    from upstox_trader.config import UPSTOX_CONFIG
    UPSTOX_AVAILABLE = True
except ImportError:
    print("⚠️ Upstox API not available. Using mock data.")
    UPSTOX_AVAILABLE = False

class TradingDataTools:
    """Tools for fetching trading data"""
    
    def __init__(self):
        self.upstox_api = None
        if UPSTOX_AVAILABLE:
            try:
                self.upstox_api = UpstoxAPI(UPSTOX_CONFIG)
            except Exception as e:
                print(f"Failed to initialize Upstox API: {e}")
    
    def get_historical_data(self, symbol: str, from_date: str, to_date: str, interval: str = "1minute") -> Dict:
        """Fetch historical OHLCV data for a symbol"""
        try:
            if self.upstox_api:
                # Convert symbol format for Upstox
                instrument_key = f"NSE_EQ|INE{symbol}"  # Simplified conversion
                data = self.upstox_api.get_historical_candle_data(
                    instrument_key, interval, to_date, from_date
                )
                return {
                    "status": "success",
                    "data": data,
                    "symbol": symbol,
                    "interval": interval,
                    "from_date": from_date,
                    "to_date": to_date
                }
            else:
                # Mock data for testing
                return self._generate_mock_data(symbol, from_date, to_date, interval)
        except Exception as e:
            return {
                "status": "error",
                "error": str(e),
                "symbol": symbol
            }
    
    def get_intraday_data(self, symbol: str, date: str) -> Dict:
        """Fetch intraday minute-by-minute data"""
        return self.get_historical_data(symbol, date, date, "1minute")
    
    def get_market_context(self, symbol: str, date: str) -> Dict:
        """Get broader market context for the trading day"""
        try:
            # Fetch NIFTY 50 data for market context
            nifty_data = self.get_historical_data("NIFTY", date, date, "1minute")
            
            # Get sector data if possible
            sector_data = self._get_sector_performance(date)
            
            return {
                "status": "success",
                "market_data": nifty_data,
                "sector_data": sector_data,
                "date": date
            }
        except Exception as e:
            return {
                "status": "error",
                "error": str(e),
                "date": date
            }
    
    def calculate_technical_indicators(self, ohlcv_data: List) -> Dict:
        """Calculate technical indicators from OHLCV data"""
        try:
            if not ohlcv_data:
                return {"status": "error", "error": "No data provided"}
            
            df = pd.DataFrame(ohlcv_data, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            df['close'] = pd.to_numeric(df['close'])
            df['high'] = pd.to_numeric(df['high'])
            df['low'] = pd.to_numeric(df['low'])
            df['volume'] = pd.to_numeric(df['volume'])
            
            # Calculate basic indicators
            df['sma_20'] = df['close'].rolling(window=20).mean()
            df['ema_9'] = df['close'].ewm(span=9).mean()
            df['rsi'] = self._calculate_rsi(df['close'])
            
            # Calculate VWAP
            df['vwap'] = (df['close'] * df['volume']).cumsum() / df['volume'].cumsum()
            
            # Support/Resistance levels
            recent_high = df['high'].tail(50).max()
            recent_low = df['low'].tail(50).min()
            
            return {
                "status": "success",
                "indicators": {
                    "current_sma_20": df['sma_20'].iloc[-1] if len(df) >= 20 else None,
                    "current_ema_9": df['ema_9'].iloc[-1] if len(df) >= 9 else None,
                    "current_rsi": df['rsi'].iloc[-1] if len(df) >= 14 else None,
                    "current_vwap": df['vwap'].iloc[-1],
                    "recent_high": recent_high,
                    "recent_low": recent_low,
                    "price_vs_vwap": "above" if df['close'].iloc[-1] > df['vwap'].iloc[-1] else "below",
                    "trend": "bullish" if df['close'].iloc[-1] > df['sma_20'].iloc[-1] else "bearish"
                },
                "data_points": len(df)
            }
        except Exception as e:
            return {"status": "error", "error": str(e)}
    
    def _calculate_rsi(self, prices, period=14):
        """Calculate RSI indicator"""
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        rs = gain / loss
        rsi = 100 - (100 / (1 + rs))
        return rsi
    
    def _get_sector_performance(self, date: str) -> Dict:
        """Get sector performance data"""
        # Mock sector data
        return {
            "IT": {"performance": "+1.2%", "trend": "bullish"},
            "Banking": {"performance": "-0.8%", "trend": "bearish"},
            "Pharma": {"performance": "+0.5%", "trend": "neutral"}
        }
    
    def _generate_mock_data(self, symbol: str, from_date: str, to_date: str, interval: str) -> Dict:
        """Generate mock data for testing"""
        import random
        
        base_price = 100.0
        data = []
        
        # Generate 375 minutes of trading data (market hours)
        for i in range(375):
            timestamp = f"2025-08-26 09:{15 + i//60:02d}:{i%60:02d}"
            open_price = base_price + random.uniform(-2, 2)
            close_price = open_price + random.uniform(-1, 1)
            high_price = max(open_price, close_price) + random.uniform(0, 0.5)
            low_price = min(open_price, close_price) - random.uniform(0, 0.5)
            volume = random.randint(1000, 10000)
            
            data.append([timestamp, open_price, high_price, low_price, close_price, volume])
            base_price = close_price
        
        return {
            "status": "success",
            "data": {"candles": data},
            "symbol": symbol,
            "interval": interval,
            "from_date": from_date,
            "to_date": to_date
        }

class TradeLossAnalyzer:
    """Main analyzer with multi-agent system"""
    
    def __init__(self):
        # Initialize OpenRouter client
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            # Use the same API key as the test file for now
            api_key = "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"
            print("⚠️ Using fallback API key for testing")
        
        self.client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key
        )
        
        self.data_tools = TradingDataTools()
        
        # Define available functions for agents
        self.available_functions = [
            {
                "type": "function",
                "function": {
                    "name": "get_historical_data",
                    "description": "Fetch historical OHLCV data for a stock symbol",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "symbol": {"type": "string", "description": "Stock symbol (e.g., WIPRO, RELIANCE)"},
                            "from_date": {"type": "string", "description": "Start date in YYYY-MM-DD format"},
                            "to_date": {"type": "string", "description": "End date in YYYY-MM-DD format"},
                            "interval": {"type": "string", "description": "Time interval (1minute, 5minute, daily)", "default": "1minute"}
                        },
                        "required": ["symbol", "from_date", "to_date"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "get_market_context",
                    "description": "Get broader market and sector context for a trading day",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "symbol": {"type": "string", "description": "Stock symbol"},
                            "date": {"type": "string", "description": "Trading date in YYYY-MM-DD format"}
                        },
                        "required": ["symbol", "date"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "calculate_technical_indicators",
                    "description": "Calculate technical indicators from OHLCV data",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "ohlcv_data": {"type": "array", "description": "Array of OHLCV data points"}
                        },
                        "required": ["ohlcv_data"]
                    }
                }
            }
        ]
    
    def execute_function_call(self, function_name: str, arguments: Dict) -> Dict:
        """Execute a function call and return results"""
        try:
            if function_name == "get_historical_data":
                return self.data_tools.get_historical_data(**arguments)
            elif function_name == "get_market_context":
                return self.data_tools.get_market_context(**arguments)
            elif function_name == "calculate_technical_indicators":
                return self.data_tools.calculate_technical_indicators(**arguments)
            else:
                return {"status": "error", "error": f"Unknown function: {function_name}"}
        except Exception as e:
            return {"status": "error", "error": str(e)}
    
    def create_specialist_agent(self, role: str, system_prompt: str) -> Dict:
        """Create a specialist agent with specific role"""
        return {
            "role": role,
            "system_prompt": system_prompt,
            "model": "mistralai/mistral-small-3.2-24b-instruct:free"
        }
    
    def get_agent_analysis(self, agent: Dict, trade_data: Dict, max_iterations: int = 5) -> Dict:
        """Get analysis from an agent with function calling"""
        messages = [
            {"role": "system", "content": agent["system_prompt"]},
            {"role": "user", "content": f"""
Analyze this losing trade and provide your expert analysis. Use the available functions to gather necessary data.

TRADE DETAILS:
{json.dumps(trade_data, indent=2)}

Please:
1. Use function calls to gather relevant data (historical data, market context, technical indicators)
2. Analyze the data from your specialty perspective
3. Provide specific insights about why this trade lost money
4. Give actionable recommendations
"""}
        ]
        
        analysis_steps = []
        
        for iteration in range(max_iterations):
            try:
                response = self.client.chat.completions.create(
                    model=agent["model"],
                    messages=messages,
                    tools=self.available_functions
                )
                
                message = response.choices[0].message
                messages.append({"role": "assistant", "content": message.content})
                
                # Check if the agent wants to call functions
                if message.tool_calls:
                    analysis_steps.append(f"Iteration {iteration + 1}: Agent requested {len(message.tool_calls)} function calls")
                    
                    # Execute all function calls and collect results
                    function_results = []
                    for tool_call in message.tool_calls:
                        function_name = tool_call.function.name
                        arguments = json.loads(tool_call.function.arguments)
                        
                        # Execute the function
                        function_result = self.execute_function_call(function_name, arguments)
                        function_results.append(f"**{function_name}**: {json.dumps(function_result, indent=2)}")
                        
                        # Add function result to conversation
                        messages.append({
                            "role": "tool", 
                            "tool_call_id": tool_call.id,
                            "content": json.dumps(function_result)
                        })
                        
                        analysis_steps.append(f"Executed {function_name} with args: {arguments}")
                    
                    # Continue conversation after function calls - ask agent to provide final analysis
                    messages.append({
                        "role": "user", 
                        "content": f"""Based on the function call results above, provide your final analysis of this losing trade. 

Data gathered: {', '.join([result.split(':')[0].replace('**', '') for result in function_results])}

Please provide:
1. Your expert analysis of why this trade lost money
2. Specific technical/risk/market factors that contributed 
3. What could have been done differently
4. Actionable recommendations for future trades

Be specific and actionable in your analysis."""
                    })
                    
                    # Continue to get final analysis
                    continue
                else:
                    # Agent provided final analysis
                    return {
                        "agent_role": agent["role"],
                        "analysis": message.content,
                        "data_gathered": analysis_steps,
                        "iterations": iteration + 1,
                        "status": "completed"
                    }
            
            except Exception as e:
                return {
                    "agent_role": agent["role"],
                    "error": str(e),
                    "analysis_steps": analysis_steps,
                    "iterations": iteration + 1,
                    "status": "error"
                }
        
        return {
            "agent_role": agent["role"],
            "analysis": messages[-1]["content"] if messages else "No analysis completed",
            "analysis_steps": analysis_steps,
            "iterations": max_iterations,
            "status": "max_iterations_reached"
        }
    
    def analyze_trade(self, trade_data: Dict) -> Dict:
        """Analyze a losing trade using multiple specialist agents"""
        print(f"🔍 Starting multi-agent analysis for {trade_data.get('symbol', 'Unknown')} trade")
        
        # Define specialist agents
        agents = {
            "Technical Analyst": self.create_specialist_agent(
                "Technical Analyst",
                """You are a highly skilled technical analyst specializing in intraday trading analysis.

Your expertise includes:
- Chart pattern recognition and price action analysis
- Technical indicator interpretation (RSI, MACD, moving averages, VWAP)
- Support and resistance level identification
- Volume analysis and market microstructure
- Entry and exit timing analysis

For each losing trade analysis:
1. Fetch historical intraday data for the stock
2. Calculate relevant technical indicators
3. Analyze the entry point timing and price action
4. Identify key technical levels that were broken
5. Assess whether the technical setup was valid
6. Evaluate stop loss placement from a technical perspective

Provide specific technical reasons why the trade failed and actionable improvements."""
            ),
            
            "Risk Management Expert": self.create_specialist_agent(
                "Risk Management Expert", 
                """You are a professional risk management expert focused on trading risk analysis.

Your expertise includes:
- Position sizing and risk calculation
- Stop loss effectiveness and slippage analysis
- Risk-reward ratio assessment
- Portfolio risk and correlation analysis
- Risk management rule compliance

For each losing trade analysis:
1. Get market context and volatility data
2. Analyze the position size relative to account risk
3. Evaluate stop loss placement and execution
4. Calculate actual vs intended risk-reward ratios
5. Assess if proper risk management rules were followed
6. Compare trade risk with market conditions

Provide specific risk management failures and concrete improvements."""
            ),
            
            "Market Context Analyst": self.create_specialist_agent(
                "Market Context Analyst",
                """You are a market context expert who analyzes how broader market conditions impact individual trades.

Your expertise includes:
- Overall market sentiment and trend analysis
- Sector performance and rotation patterns
- Institutional flow and market regime analysis
- Time-of-day and session effect analysis
- News and event impact assessment

For each losing trade analysis:
1. Fetch market data (NIFTY, sector indices) for the trade day
2. Analyze broader market conditions and volatility
3. Assess sector performance and correlations
4. Evaluate market timing and session effects
5. Identify any external factors that impacted the trade
6. Determine if market conditions were favorable for the strategy

Provide insights on how market environment contributed to the loss."""
            )
        }
        
        # Get analysis from each specialist agent
        specialist_analyses = {}
        
        for agent_name, agent in agents.items():
            print(f"  📊 Getting analysis from {agent_name}...")
            analysis = self.get_agent_analysis(agent, trade_data)
            specialist_analyses[agent_name] = analysis
            
            if analysis["status"] == "completed":
                print(f"  ✅ {agent_name} completed analysis in {analysis['iterations']} iterations")
            else:
                print(f"  ⚠️ {agent_name} analysis had issues: {analysis['status']}")
        
        # Judge Expert validates and synthesizes findings
        judge_analysis = self._get_judge_analysis(trade_data, specialist_analyses)
        
        return {
            "trade_data": trade_data,
            "specialist_analyses": specialist_analyses,
            "judge_analysis": judge_analysis,
            "analyzed_at": datetime.now().isoformat()
        }
    
    def _get_judge_analysis(self, trade_data: Dict, specialist_analyses: Dict) -> Dict:
        """Judge Expert validates and synthesizes all specialist findings"""
        print("  ⚖️ Getting Judge Expert validation and synthesis...")
        
        judge_agent = self.create_specialist_agent(
            "Judge Expert",
            """You are a Master Trading Judge Expert with 20+ years of experience validating trading analysis.

Your role is to:
- Critically evaluate all specialist analyses for accuracy and completeness
- Identify contradictions or gaps in the analyses
- Synthesize findings into a definitive root cause analysis
- Rank contributing factors by importance (1-5 scale)
- Provide final verdict on the primary cause of loss
- Give specific, actionable improvement recommendations

Analysis framework:
1. PRIMARY CAUSE (most important factor that caused the loss)
2. SECONDARY FACTORS (ranked by contribution to loss)  
3. VALIDATION ASSESSMENT (quality of specialist analyses)
4. LESSONS LEARNED (key takeaways)
5. SPECIFIC IMPROVEMENTS (concrete actions to prevent similar losses)

Be decisive and provide clear judgments. Focus on what can be controlled and improved."""
        )
        
        # Compile all specialist findings
        specialist_summary = ""
        for agent_name, analysis in specialist_analyses.items():
            specialist_summary += f"\n=== {agent_name} Analysis ===\n"
            if analysis["status"] == "completed":
                specialist_summary += analysis["analysis"]
                if "data_gathered" in analysis:
                    specialist_summary += f"\nData gathered: {analysis['data_gathered']}\n"
            else:
                specialist_summary += f"Analysis failed: {analysis.get('error', 'Unknown error')}\n"
        
        judge_input = {
            "trade_data": trade_data,
            "specialist_findings": specialist_summary
        }
        
        try:
            judge_analysis = self.get_agent_analysis(judge_agent, judge_input, max_iterations=3)
            print(f"  ✅ Judge Expert completed validation")
            return judge_analysis
        except Exception as e:
            print(f"  ⚠️ Judge Expert analysis failed: {e}")
            return {
                "agent_role": "Judge Expert",
                "error": str(e),
                "status": "error"
            }

class LogTradeParser:
    """Parser for trading log files"""
    
    def __init__(self):
        self.trades = []
        self.losing_trades = []
    
    def parse_log_file(self, log_file_path: str) -> List[Dict]:
        """Parse complete log file and extract all trades"""
        try:
            with open(log_file_path, 'r') as f:
                lines = f.readlines()
            
            self.trades = []
            entries = {}  # Track open positions
            
            for line_num, line in enumerate(lines, 1):
                line = line.strip()
                
                # Skip comments and headers
                if line.startswith('#') or line.startswith('-') or not line:
                    continue
                
                trade_data = self._parse_trade_line(line, line_num)
                if not trade_data:
                    continue
                
                if trade_data['action'] == 'ENTRY':
                    # Store entry for matching with exit
                    key = f"{trade_data['symbol']}_{trade_data['side']}"
                    entries[key] = trade_data
                
                elif trade_data['action'] == 'EXIT':
                    # Match with entry to create complete trade
                    entry_side = 'BUY' if trade_data['side'] == 'SELL' else 'SELL'
                    key = f"{trade_data['symbol']}_{entry_side}"
                    
                    if key in entries:
                        entry_data = entries[key]
                        complete_trade = self._create_complete_trade(entry_data, trade_data)
                        self.trades.append(complete_trade)
                        
                        # Track losing trades - check for losing trades regardless of complete trade status
                        if trade_data.get('pnl_amount') is not None and trade_data.get('pnl_amount') < 0:
                            # Use the trade_data directly for losing trades since it has P&L info
                            losing_trade = complete_trade.copy()
                            losing_trade['pnl_amount'] = trade_data['pnl_amount']
                            losing_trade['pnl_percentage'] = trade_data['pnl_percentage']
                            self.losing_trades.append(losing_trade)
                        
                        del entries[key]
                    else:
                        # Exit without matching entry - might be a losing trade we still want to track
                        if trade_data.get('pnl_amount') is not None and trade_data.get('pnl_amount') < 0:
                            # Create a partial trade record for analysis
                            losing_trade = {
                                'symbol': trade_data['symbol'],
                                'exit_time': trade_data['timestamp'],
                                'exit_price': trade_data['price'],
                                'quantity': trade_data['quantity'],
                                'pnl_amount': trade_data['pnl_amount'],
                                'pnl_percentage': trade_data['pnl_percentage'],
                                'exit_reason': trade_data['exit_reason'],
                                'trade_date': trade_data['timestamp'].split(' ')[0],
                                'entry_time': 'Unknown',
                                'entry_price': 0,
                                'hold_time': 'Unknown',
                                'side': 'BUY' if trade_data['side'] == 'SELL' else 'SELL'
                            }
                            self.losing_trades.append(losing_trade)
            
            return self.trades
            
        except Exception as e:
            print(f"Error parsing log file {log_file_path}: {e}")
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
            amount_str = parts[5].replace('₹', '').replace(',', '')
            
            # Parse action and side
            if action_side.startswith('ENTRY_'):
                action = 'ENTRY'
                side = action_side.replace('ENTRY_', '')
            elif action_side.startswith('EXIT_'):
                action = 'EXIT'
                side = action_side.replace('EXIT_', '')
            else:
                return None
            
            # Parse P&L if exit trade
            pnl_percentage = None
            pnl_amount = None
            exit_reason = None
            
            if action == 'EXIT' and len(parts) >= 8:
                exit_info = parts[6]  # Exit reason
                pnl_info = parts[7] if len(parts) > 7 else ""
                
                exit_reason = exit_info
                
                # Extract P&L from the P&L info
                import re
                # Try to find P&L info anywhere in the exit line
                full_line = ' | '.join(parts[6:])  # Join all remaining parts
                pnl_match = re.search(r'P&L: ([+-]?\d+\.?\d*)% \(₹?([+-]?\d+\.?\d*)\)', full_line)
                if pnl_match:
                    pnl_percentage = float(pnl_match.group(1))
                    pnl_amount = float(pnl_match.group(2))
                else:
                    # Also try to extract from the exit reason if it contains percentage
                    pnl_match2 = re.search(r'([+-]?\d+\.?\d*)%.*₹?([+-]?\d+\.?\d*)', exit_info)
                    if pnl_match2:
                        pnl_percentage = float(pnl_match2.group(1))
                        # Try to extract amount from anywhere in the line
                        amount_match = re.search(r'₹([+-]?\d+)', full_line)
                        if amount_match:
                            pnl_amount = float(amount_match.group(1))
            
            return {
                'timestamp': timestamp,
                'action': action,
                'side': side,
                'symbol': symbol,
                'price': float(price_str),
                'quantity': quantity,
                'amount': float(amount_str),
                'exit_reason': exit_reason,
                'pnl_percentage': pnl_percentage,
                'pnl_amount': pnl_amount,
                'line_num': line_num
            }
            
        except Exception as e:
            print(f"Error parsing line {line_num}: {line} - {e}")
            return None
    
    def _create_complete_trade(self, entry: Dict, exit: Dict) -> Dict:
        """Create complete trade from entry and exit"""
        # Calculate hold time
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
            'side': entry['side'],  # BUY or SELL
            'entry_amount': entry['amount'],
            'exit_amount': exit['amount'],
            'pnl_percentage': exit['pnl_percentage'],
            'pnl_amount': exit['pnl_amount'],
            'hold_time_minutes': hold_minutes,
            'hold_time': f"{hold_minutes}m",
            'exit_reason': exit['exit_reason'],
            'trade_date': entry['timestamp'].split(' ')[0],
            'entry_line': entry['line_num'],
            'exit_line': exit['line_num']
        }
    
    def get_losing_trades(self) -> List[Dict]:
        """Get all losing trades from parsed data"""
        return self.losing_trades
    
    def get_trade_by_symbol_time(self, symbol: str, entry_time: str) -> Optional[Dict]:
        """Get specific trade by symbol and entry time"""
        for trade in self.trades:
            if trade['symbol'] == symbol and trade['entry_time'] == entry_time:
                return trade
        return None

def analyze_log_file(log_file_path: str, trade_index: int = None, symbol_filter: str = None):
    """Analyze losing trades from log file"""
    print(f"📖 Parsing trading log: {os.path.basename(log_file_path)}")
    
    parser = LogTradeParser()
    all_trades = parser.parse_log_file(log_file_path)
    losing_trades = parser.get_losing_trades()
    
    if not losing_trades:
        print("✅ No losing trades found in this log!")
        return
    
    print(f"📊 Found {len(all_trades)} total trades, {len(losing_trades)} losing trades")
    
    # Filter trades if specified
    if symbol_filter:
        losing_trades = [t for t in losing_trades if symbol_filter.upper() in t['symbol'].upper()]
        print(f"🔍 Filtered to {len(losing_trades)} trades containing '{symbol_filter}'")
    
    if not losing_trades:
        print("❌ No losing trades match your filter criteria")
        return
    
    # Show available trades
    print("\n📋 Available losing trades:")
    for i, trade in enumerate(losing_trades):
        print(f"  {i+1}. {trade['symbol']} - {trade['entry_time']} - P&L: {trade['pnl_amount']:.0f} ({trade['pnl_percentage']:.2f}%)")
    
    # Select trade to analyze
    if trade_index is None:
        try:
            trade_index = int(input(f"\nSelect trade to analyze (1-{len(losing_trades)}): ")) - 1
        except (ValueError, KeyboardInterrupt):
            print("❌ Invalid selection or cancelled")
            return
    else:
        trade_index = trade_index - 1  # Convert to 0-based index
    
    if trade_index < 0 or trade_index >= len(losing_trades):
        print("❌ Invalid trade index")
        return
    
    selected_trade = losing_trades[trade_index]
    print(f"\n🎯 Analyzing: {selected_trade['symbol']} - P&L: ₹{selected_trade['pnl_amount']:.0f}")
    
    # Initialize analyzer and perform analysis
    analyzer = TradeLossAnalyzer()
    analysis_result = analyzer.analyze_trade(selected_trade)
    
    # Save results
    output_file = f"loss_analysis_{selected_trade['symbol']}_{selected_trade['trade_date'].replace('-', '')}_{selected_trade['entry_time'].replace(':', '').replace(' ', '_')}.json"
    with open(output_file, 'w') as f:
        json.dump(analysis_result, f, indent=2)
    
    print(f"\n✅ Analysis completed! Results saved to {output_file}")
    
    # Display readable analysis
    display_analysis_results(analysis_result)
    
    print(f"\n📄 Full JSON data available in: {output_file}")

def display_analysis_results(analysis_result: Dict):
    """Display analysis results in a human-readable format"""
    trade = analysis_result["trade_data"]
    
    print("\n" + "=" * 80)
    print(f"🎯 TRADE LOSS ANALYSIS: {trade['symbol']}")
    print("=" * 80)
    
    print(f"\n📊 TRADE DETAILS:")
    print(f"   Symbol: {trade['symbol']}")
    print(f"   Entry: {trade['entry_time']} at ₹{trade['entry_price']}")
    print(f"   Exit:  {trade['exit_time']} at ₹{trade['exit_price']}")
    print(f"   Duration: {trade['hold_time']} ({trade['hold_time_minutes']} minutes)")
    print(f"   P&L: ₹{trade['pnl_amount']} ({trade['pnl_percentage']}%)")
    print(f"   Exit Reason: {trade['exit_reason']}")
    
    print(f"\n" + "=" * 80)
    print("🔍 SPECIALIST ANALYSIS")
    print("=" * 80)
    
    for agent_name, analysis in analysis_result["specialist_analyses"].items():
        print(f"\n📋 {agent_name.upper()}")
        print("-" * 60)
        if analysis["status"] == "completed":
            # Clean up the analysis text
            analysis_text = analysis["analysis"].replace("[TOOL_CALLS", "").replace("[ARGS", "").replace("SPECIAL_27", "")
            analysis_text = analysis_text.replace("{", "").replace("}", "").replace("[", "").replace("]", "")
            print(analysis_text)
            
            if "data_gathered" in analysis:
                print(f"\n🔧 Data Gathered: {len(analysis['data_gathered'])} function calls")
        else:
            print(f"❌ Analysis failed: {analysis.get('error', 'Unknown error')}")
    
    print(f"\n" + "=" * 80)
    print("⚖️ JUDGE EXPERT VERDICT")
    print("=" * 80)
    
    judge = analysis_result["judge_analysis"]
    if judge["status"] == "completed":
        # Clean up the judge analysis
        judge_text = judge["analysis"].replace("[TOOL_CALLS", "").replace("[ARGS", "").replace("SPECIAL_27", "")
        judge_text = judge_text.replace("{", "").replace("}", "").replace("[", "").replace("]", "")
        print(judge_text)
    else:
        print(f"❌ Judge analysis failed: {judge.get('error', 'Unknown error')}")
    
    print("\n" + "=" * 80)

def main():
    """Main execution function"""
    import sys
    
    print("🚀 Trade Loss Analyzer Agents - Log File Analysis")
    
    if len(sys.argv) < 2:
        print("Usage: python trade_loss_analyzer_agents.py <log_file.log> [options]")
        print("\nOptions:")
        print("  --trade-index N     Analyze specific trade number (1-based)")
        print("  --symbol SYMBOL     Filter trades by symbol")
        print("\nExamples:")
        print("  python trade_loss_analyzer_agents.py logs/tv_screener_fomo_26aug.log")
        print("  python trade_loss_analyzer_agents.py logs/tv_screener_fomo_26aug.log --trade-index 3")
        print("  python trade_loss_analyzer_agents.py logs/tv_screener_fomo_26aug.log --symbol WIPRO")
        return
    
    log_file = sys.argv[1]
    
    if not os.path.exists(log_file):
        print(f"❌ Log file not found: {log_file}")
        return
    
    # Parse command line options
    trade_index = None
    symbol_filter = None
    
    i = 2
    while i < len(sys.argv):
        if sys.argv[i] == '--trade-index' and i + 1 < len(sys.argv):
            try:
                trade_index = int(sys.argv[i + 1])
                i += 2
            except ValueError:
                print("❌ Invalid trade index")
                return
        elif sys.argv[i] == '--symbol' and i + 1 < len(sys.argv):
            symbol_filter = sys.argv[i + 1]
            i += 2
        else:
            i += 1
    
    # Analyze log file
    analyze_log_file(log_file, trade_index, symbol_filter)

if __name__ == "__main__":
    main()
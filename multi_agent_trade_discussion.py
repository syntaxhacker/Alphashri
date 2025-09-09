#!/usr/bin/env python3
"""
Multi-Agent Trade Loss Discussion System
Agents discuss and debate trade losses to reach better conclusions
"""

import json
import os
import sys
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from openai import OpenAI
from typing import Dict, List, Optional
import requests
import gzip

class EnhancedDataAnalyzer:
    """Enhanced data analyzer with technical indicators and real market data"""
    
    def __init__(self):
        self.upstox_token = os.environ.get("UPSTOX_ACCESS_TOKEN")
        self.nse_instruments = None
    
    def load_nse_instruments(self) -> Dict:
        """Load NSE equity instruments mapping"""
        if self.nse_instruments:
            return self.nse_instruments
            
        try:
            url = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"
            response = requests.get(url, timeout=30)
            
            if response.status_code == 200:
                decompressed_data = gzip.decompress(response.content)
                instruments_data = json.loads(decompressed_data.decode('utf-8'))
                
                mapping = {}
                equity_instruments_sample = [] # To store a sample of NSE_EQ instruments
                for instrument in instruments_data:
                    if instrument.get('segment') == 'NSE_EQ': # Filter only by segment for now
                        symbol_key = instrument.get('tradingsymbol') # Get raw value, not defaulted
                        instrument_key = instrument.get('instrument_key') # Get raw value, not defaulted
                        
                        # Store regardless of whether symbol_key or instrument_key are None/empty
                        # This allows us to inspect their actual values.
                        if symbol_key is not None and instrument_key is not None: # Only add if keys exist at all
                             mapping[symbol_key] = {
                                'instrument_key': instrument_key,
                                'name': instrument.get('name', ''),
                                'isin': instrument.get('isin', ''),
                                'lot_size': instrument.get('lot_size', 1),
                                'instrument_type': instrument.get('instrument_type', '') # Keep type for inspection
                            }
                        
                        if len(equity_instruments_sample) < 20: # Get a sample of 20
                            equity_instruments_sample.append(instrument)
                
                self.nse_instruments = mapping
                print(f"✅ Successfully loaded {len(mapping)} NSE instruments (filtered by segment only).")
                
                # Debugging: Print counts of different segments and instrument_types from original data
                segment_counts = {}
                type_counts = {}
                for instrument in instruments_data:
                    segment = instrument.get('segment')
                    inst_type = instrument.get('instrument_type')
                    segment_counts[segment] = segment_counts.get(segment, 0) + 1
                    type_counts[inst_type] = type_counts.get(inst_type, 0) + 1
                print(f"🔍 Overall Segment counts: {segment_counts}")
                print(f"🔍 Overall Instrument type counts: {type_counts}")

                # Debugging: Print a sample of loaded NSE_EQ instruments to inspect their specific fields
                print("\n🔍 Inspecting first 20 NSE_EQ instruments (raw fields):")
                for i, instrument in enumerate(equity_instruments_sample):
                    print(f"  Instrument {i+1}: tradingsymbol='{instrument.get('tradingsymbol')}', instrument_key='{instrument.get('instrument_key')}', name='{instrument.get('name')}', segment='{instrument.get('segment')}', instrument_type='{instrument.get('instrument_type')}'")

                return mapping
        except Exception as e:
            print(f"⚠️ Failed to load NSE instruments: {e}")
            
        return {}
    
    def get_instrument_key(self, symbol: str) -> Optional[str]:
        """Get instrument key for symbol with variations"""
        instruments = self.load_nse_instruments()
        print(f"🔍 Attempting to find instrument key for symbol: '{symbol}'")
        
        if symbol in instruments:
            print(f"✅ Found exact match for '{symbol}': {instruments[symbol]['instrument_key']}")
            return instruments[symbol]['instrument_key']
        
        # Try variations
        variations = [
            symbol.upper(),
            symbol.replace('-', ''),
            symbol.replace('&', '_'),
            symbol.replace('.', '')
        ]
        
        for variation in variations:
            if variation in instruments:
                print(f"✅ Found match for variation '{variation}': {instruments[variation]['instrument_key']}")
                return instruments[variation]['instrument_key']
        
        print(f"❌ No instrument key found for '{symbol}' or its variations.")
        return None
    
    def fetch_historical_data(self, symbol: str, from_date: str, to_date: str, interval: str = "15") -> pd.DataFrame:
        """Fetch historical data using Upstox API"""
        instrument_key = self.get_instrument_key(symbol)
        if not instrument_key:
            raise ValueError(f"No instrument key found for {symbol}")
        
        if not self.upstox_token:
            raise ValueError("Upstox access token not provided. Cannot fetch live data.")
        
        try:
            url = f"https://api.upstox.com/v3/historical-candle/{instrument_key}/minutes/{interval}/{to_date}/{from_date}"
            headers = {
                "Accept": "application/json",
                "Authorization": f"Bearer {self.upstox_token}"
            }
            
            response = requests.get(url, headers=headers)
            if response.status_code == 200:
                data = response.json()
                if data.get('status') == 'success':
                    candles = data['data']['candles']
                    df = pd.DataFrame(candles, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume', 'oi'])
                    df['timestamp'] = pd.to_datetime(df['timestamp'])
                    return df.sort_values('timestamp')
                else:
                    raise ValueError(f"Upstox API returned an error: {data.get('message', 'Unknown error')}")
            else:
                raise ValueError(f"Upstox API error: {response.status_code} - {response.text}")
            
        except requests.exceptions.RequestException as e:
            raise ConnectionError(f"Network error fetching data from Upstox: {e}")
        except Exception as e:
            raise RuntimeError(f"Error fetching data: {e}")
    
    def calculate_technical_indicators(self, df: pd.DataFrame) -> Dict:
        """Calculate technical indicators"""
        if df.empty:
            return {}
        
        try:
            # Moving averages
            df['sma_20'] = df['close'].rolling(window=20).mean()
            df['sma_50'] = df['close'].rolling(window=50).mean()
            df['ema_9'] = df['close'].ewm(span=9).mean()
            df['ema_21'] = df['close'].ewm(span=21).mean()
            
            # RSI
            df['rsi'] = self._calculate_rsi(df['close'])
            
            # MACD
            df['macd'], df['macd_signal'] = self._calculate_macd(df['close'])
            df['macd_histogram'] = df['macd'] - df['macd_signal']
            
            # Bollinger Bands
            df['bb_middle'] = df['close'].rolling(window=20).mean()
            bb_std = df['close'].rolling(window=20).std()
            df['bb_upper'] = df['bb_middle'] + (bb_std * 2)
            df['bb_lower'] = df['bb_middle'] - (bb_std * 2)
            
            # Support/Resistance levels
            support_resistance = self._find_support_resistance(df)
            
            # VWAP
            df['vwap'] = (df['close'] * df['volume']).cumsum() / df['volume'].cumsum()
            
            return {
                'dataframe': df,
                'support_levels': support_resistance['support'],
                'resistance_levels': support_resistance['resistance'],
                'current_price': float(df['close'].iloc[-1]),
                'current_rsi': float(df['rsi'].iloc[-1]) if not pd.isna(df['rsi'].iloc[-1]) else None,
                'current_macd': float(df['macd'].iloc[-1]) if not pd.isna(df['macd'].iloc[-1]) else None,
                'current_vwap': float(df['vwap'].iloc[-1]) if not pd.isna(df['vwap'].iloc[-1]) else None,
                'sma_20': float(df['sma_20'].iloc[-1]) if not pd.isna(df['sma_20'].iloc[-1]) else None,
                'sma_50': float(df['sma_50'].iloc[-1]) if not pd.isna(df['sma_50'].iloc[-1]) else None
            }
            
        except Exception as e:
            print(f"Error calculating indicators: {e}")
            return {}
    
    def _calculate_rsi(self, prices: pd.Series, period: int = 14) -> pd.Series:
        """Calculate RSI"""
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        rs = gain / loss
        rsi = 100 - (100 / (1 + rs))
        return rsi
    
    def _calculate_macd(self, prices: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> tuple:
        """Calculate MACD"""
        ema_fast = prices.ewm(span=fast).mean()
        ema_slow = prices.ewm(span=slow).mean()
        macd = ema_fast - ema_slow
        macd_signal = macd.ewm(span=signal).mean()
        return macd, macd_signal
    
    def _find_support_resistance(self, df: pd.DataFrame, window: int = 20) -> Dict:
        """Find support and resistance levels"""
        highs = df['high'].rolling(window=window, center=True).max()
        lows = df['low'].rolling(window=window, center=True).min()
        
        resistance_levels = []
        support_levels = []
        
        for i in range(window, len(df) - window):
            if df['high'].iloc[i] == highs.iloc[i]:
                resistance_levels.append(df['high'].iloc[i])
            if df['low'].iloc[i] == lows.iloc[i]:
                support_levels.append(df['low'].iloc[i])
        
        # Keep only significant levels (remove duplicates within 1%)
        resistance_levels = self._filter_levels(resistance_levels)
        support_levels = self._filter_levels(support_levels)
        
        return {
            'resistance': sorted(resistance_levels, reverse=True)[:5],  # Top 5
            'support': sorted(support_levels, reverse=True)[:5]       # Top 5
        }
    
    def _filter_levels(self, levels: List[float], threshold: float = 0.01) -> List[float]:
        """Filter out similar levels within threshold"""
        if not levels:
            return []
        
        filtered = [levels[0]]
        for level in levels[1:]:
            is_unique = True
            for existing in filtered:
                if abs(level - existing) / existing < threshold:
                    is_unique = False
                    break
            if is_unique:
                filtered.append(level)
        
        return filtered
    
    def analyze_wider_stop_impact(self, df: pd.DataFrame, entry_price: float, entry_time: str, wider_stop_pct: float = 0.5) -> Dict:
        """Analyze what would have happened with a wider stop loss"""
        if df.empty:
            return {}
        
        try:
            entry_timestamp = pd.to_datetime(entry_time)
            
            # Find data from entry time onwards
            future_data = df[df['timestamp'] >= entry_timestamp].copy()
            if future_data.empty:
                return {}
            
            wider_stop_price = entry_price * (1 - wider_stop_pct / 100)
            
            # Check if wider stop would have been hit
            wider_stop_hit = future_data['low'].min() <= wider_stop_price
            
            # Find maximum potential profit
            max_high = future_data['high'].max()
            max_profit_pct = ((max_high - entry_price) / entry_price) * 100
            
            # Find when max high occurred
            max_high_time = future_data[future_data['high'] == max_high]['timestamp'].iloc[0]
            
            # Analyze price at different time intervals
            intervals = ['5m', '15m', '30m', '1h', '2h', '4h']
            price_at_intervals = {}
            
            for interval in intervals:
                minutes_map = {'5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240}
                target_time = entry_timestamp + timedelta(minutes=minutes_map[interval])
                
                closest_data = future_data[future_data['timestamp'] <= target_time]
                if not closest_data.empty:
                    price = closest_data['close'].iloc[-1]
                    profit_pct = ((price - entry_price) / entry_price) * 100
                    price_at_intervals[interval] = {
                        'price': float(price),
                        'profit_pct': float(profit_pct),
                        'time': str(closest_data['timestamp'].iloc[-1])
                    }
            
            return {
                'wider_stop_pct': wider_stop_pct,
                'wider_stop_price': wider_stop_price,
                'wider_stop_hit': wider_stop_hit,
                'max_high': float(max_high),
                'max_profit_pct': float(max_profit_pct),
                'max_high_time': str(max_high_time),
                'price_at_intervals': price_at_intervals
            }
            
        except Exception as e:
            print(f"Error analyzing wider stop impact: {e}")
            return {}

class MultiAgentTradeDiscussion:
    """Multi-agent system where agents discuss and debate trade losses"""
    
    def __init__(self):
        # Use the test API key
        api_key = "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"
        self.client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key
        )
        
        # Initialize enhanced data analyzer
        self.data_analyzer = EnhancedDataAnalyzer()
        
        # Define agent personas
        self.agents = {
            "Technical_Analyst": {
                "name": "Alex (Technical Analyst)",
                "persona": """You are Alex, a senior technical analyst with 15 years of experience. You focus on:
- Price action and chart patterns
- Technical indicators and signals  
- Entry/exit timing from technical perspective
- Support/resistance levels
You tend to be analytical and data-driven, sometimes disagreeing with others when they ignore technical factors."""
            },
            
            "Risk_Manager": {
                "name": "Sarah (Risk Manager)",
                "persona": """You are Sarah, a professional risk management expert with 12 years of experience. You focus on:
- Position sizing and risk exposure
- Stop loss effectiveness and placement
- Risk-reward ratios and probability
- Capital preservation strategies
You tend to be conservative and safety-focused, often challenging others when they take excessive risks."""
            },
            
            "Market_Timer": {
                "name": "Mike (Market Timer)",
                "persona": """You are Mike, a market timing specialist with 10 years of experience. You focus on:
- Market session analysis and timing
- Volatility patterns and market microstructure
- Opening/closing effects and optimal entry times
- Market sentiment and flow analysis
You tend to be detail-oriented about timing, often pointing out when others miss timing-related factors."""
            },
            
            "Judge_Expert": {
                "name": "Dr. Chen (Judge Expert)",
                "persona": """You are Dr. Chen, a master trading analyst with 20+ years of experience judging trading performance. You:
- Synthesize different perspectives objectively
- Challenge weak arguments and demand evidence
- Rank factors by actual impact on P&L
- Make final decisions on root causes
You tend to be decisive but fair, cutting through opinions to focus on facts that affect profitability."""
            }
        }
        
        self.discussion_history = []
    
    def analyze_trade_with_discussion(self, trade_data: Dict) -> Dict:
        """Analyze trade through multi-agent discussion with enhanced data"""
        print(f"🗣️ Starting enhanced multi-agent discussion for {trade_data['symbol']} trade")
        
        # Fetch and analyze enhanced data
        print("  📊 Fetching historical data and calculating indicators...")
        enhanced_data = self._get_enhanced_trade_data(trade_data)
        
        trade_summary = self._format_enhanced_trade_summary(trade_data, enhanced_data)
        self.discussion_history = []
        
        # Round 1: Initial analysis from each specialist
        print("\n📋 ROUND 1: Initial Analysis")
        specialist_views = self._get_initial_analyses(trade_summary)
        
        # Round 2: Discussion and debate
        print("\n🗣️ ROUND 2: Discussion & Debate")  
        discussion_round = self._conduct_discussion(trade_summary, specialist_views)
        
        # Round 3: Judge synthesis and final verdict
        print("\n⚖️ ROUND 3: Judge Final Verdict")
        final_verdict = self._get_judge_verdict(trade_summary, specialist_views, discussion_round)
        
        return {
            'trade_data': trade_data,
            'enhanced_data': enhanced_data,
            'round_1_analyses': specialist_views,
            'round_2_discussion': discussion_round,
            'round_3_verdict': final_verdict,
            'full_discussion': self.discussion_history,
            'analyzed_at': datetime.now().isoformat()
        }
    
    def _get_enhanced_trade_data(self, trade_data: Dict) -> Dict:
        """Fetch and analyze enhanced trade data"""
        symbol = trade_data['symbol']
        entry_time = trade_data['entry_time']
        entry_price = trade_data['entry_price']
        
        # Get date range for analysis (5 days before to 1 day after trade)
        entry_date = datetime.strptime(entry_time.split(' ')[0], '%Y-%m-%d')
        from_date = (entry_date - timedelta(days=5)).strftime('%Y-%m-%d')
        to_date = (entry_date + timedelta(days=1)).strftime('%Y-%m-%d')
        
        try:
            # Fetch historical data
            df = self.data_analyzer.fetch_historical_data(symbol, from_date, to_date)
            
            # Calculate technical indicators
            technical_data = self.data_analyzer.calculate_technical_indicators(df)
            
            # Analyze wider stop impact
            wider_stop_analysis = self.data_analyzer.analyze_wider_stop_impact(
                df, entry_price, entry_time, wider_stop_pct=0.5
            )
            
            return {
                'historical_data_available': not df.empty,
                'data_points': len(df),
                'technical_indicators': technical_data,
                'wider_stop_analysis': wider_stop_analysis,
                'date_range': f"{from_date} to {to_date}"
            }
            
        except (ValueError, ConnectionError, RuntimeError) as e:
            print(f"⚠️ Error getting enhanced data: {e}")
            return {
                'historical_data_available': False,
                'error': str(e)
            }
        except Exception as e:
            print(f"⚠️ An unexpected error occurred while getting enhanced data: {e}")
            return {
                'historical_data_available': False,
                'error': f"Unexpected error: {e}"
            }
    
    def _format_enhanced_trade_summary(self, trade: Dict, enhanced_data: Dict) -> str:
        """Format trade data with enhanced analysis for discussion"""
        base_summary = f"""
TRADE LOSS TO ANALYZE:

Symbol: {trade['symbol']}
Entry: {trade['entry_time']} at ₹{trade['entry_price']}
Exit: {trade['exit_time']} at ₹{trade['exit_price']}
Duration: {trade['hold_time']} ({trade['hold_time_minutes']} minutes)
P&L: ₹{trade['pnl_amount']} ({trade['pnl_percentage']}%)
Exit Reason: {trade['exit_reason']}
Position: {trade['side']} {trade['quantity']} shares

KEY OBSERVATIONS:
- Trade lasted only {trade['hold_time_minutes']} minutes
- Entry was at 09:20 (5 minutes after market open)
- Exit price (₹{trade['exit_price']}) was {'ABOVE' if trade['exit_price'] > trade['entry_price'] else 'BELOW'} entry price (₹{trade['entry_price']})
- Loss of ₹{abs(trade['pnl_amount'])} despite price moving {'up' if trade['exit_price'] > trade['entry_price'] else 'down'}
"""
        
        # Add enhanced data if available
        if enhanced_data.get('historical_data_available'):
            tech_data = enhanced_data.get('technical_indicators', {})
            wider_stop = enhanced_data.get('wider_stop_analysis', {})
            
            enhanced_summary = f"""
ENHANCED TECHNICAL ANALYSIS:
- Historical data points: {enhanced_data.get('data_points', 0)} (from {enhanced_data.get('date_range', 'N/A')})
- Current RSI: {tech_data.get('current_rsi', 'N/A'):.1f}
- Current VWAP: ₹{tech_data.get('current_vwap', 0):.2f}
- 20-day SMA: ₹{tech_data.get('sma_20', 0):.2f}
- Support levels: {[f'₹{level:.2f}' for level in tech_data.get('support_levels', [])[:3]]}
- Resistance levels: {[f'₹{level:.2f}' for level in tech_data.get('resistance_levels', [])[:3]]}

WIDER STOP ANALYSIS (0.5% vs 0.25%):
- Wider stop price: ₹{wider_stop.get('wider_stop_price', 0):.2f}
- Would wider stop be hit?: {'YES' if wider_stop.get('wider_stop_hit') else 'NO'}
- Maximum high reached: ₹{wider_stop.get('max_high', 0):.2f}
- Maximum potential profit: {wider_stop.get('max_profit_pct', 0):.2f}%
- Max high reached at: {wider_stop.get('max_high_time', 'N/A')}

PRICE AT DIFFERENT TIME INTERVALS:"""
            
            intervals_data = wider_stop.get('price_at_intervals', {})
            for interval, data in intervals_data.items():
                enhanced_summary += f"""
- After {interval}: ₹{data['price']:.2f} ({data['profit_pct']:+.2f}%)"""
            
            return base_summary + enhanced_summary
        
        else:
            return base_summary + f"""
ENHANCED DATA: Not available ({enhanced_data.get('error', 'Unknown error')})
"""
    
    def _format_trade_summary(self, trade: Dict) -> str:
        """Format trade data for discussion"""
        return f"""
TRADE LOSS TO ANALYZE:

Symbol: {trade['symbol']}
Entry: {trade['entry_time']} at ₹{trade['entry_price']}
Exit: {trade['exit_time']} at ₹{trade['exit_price']}
Duration: {trade['hold_time']} ({trade['hold_time_minutes']} minutes)
P&L: ₹{trade['pnl_amount']} ({trade['pnl_percentage']}%)
Exit Reason: {trade['exit_reason']}
Position: {trade['side']} {trade['quantity']} shares

KEY OBSERVATIONS:
- Trade lasted only {trade['hold_time_minutes']} minutes
- Entry was at 09:20 (5 minutes after market open)
- Exit price (₹{trade['exit_price']}) was {'ABOVE' if trade['exit_price'] > trade['entry_price'] else 'BELOW'} entry price (₹{trade['entry_price']})
- Loss of ₹{abs(trade['pnl_amount'])} despite price moving {'up' if trade['exit_price'] > trade['entry_price'] else 'down'}
"""
    
    def _get_initial_analyses(self, trade_summary: str) -> Dict:
        """Get initial analysis from each specialist agent"""
        analyses = {}
        
        for agent_key, agent_info in self.agents.items():
            if agent_key == "Judge_Expert":  # Judge comes later
                continue
                
            print(f"  📊 {agent_info['name']} analyzing...")
            
            prompt = f"""
{agent_info['persona']}

Analyze this losing trade from your expertise area:

{trade_summary}

Provide your initial analysis focusing on your specialization. Be specific about:
1. What went wrong from your perspective?
2. What evidence supports your analysis?
3. What should have been done differently?

Keep your analysis focused and under 300 words.
"""
            
            try:
                response = self.client.chat.completions.create(
                    model="mistralai/mistral-small-3.2-24b-instruct:free",
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=400
                )
                analysis = response.choices[0].message.content
                analyses[agent_key] = {
                    'agent': agent_info['name'],
                    'analysis': analysis
                }
                self.discussion_history.append(f"**{agent_info['name']}**: {analysis}")
                
            except Exception as e:
                analyses[agent_key] = {
                    'agent': agent_info['name'],
                    'analysis': f"Analysis failed: {e}"
                }
        
        return analyses
    
    def _conduct_discussion(self, trade_summary: str, initial_analyses: Dict) -> List[Dict]:
        """Conduct discussion between agents where they can challenge each other"""
        discussion_rounds = []
        
        # Prepare discussion context
        context = f"""
TRADE BEING DISCUSSED:
{trade_summary}

INITIAL ANALYSES:
"""
        for agent_key, analysis in initial_analyses.items():
            context += f"\n{analysis['agent']}: {analysis['analysis']}\n"
        
        # Discussion rounds
        discussion_topics = [
            {
                'topic': 'Primary Cause Debate',
                'question': 'What do you think was the PRIMARY cause of this loss? Challenge others if you disagree with their assessment.',
                'participants': ['Technical_Analyst', 'Risk_Manager', 'Market_Timer']
            },
            {
                'topic': 'Evidence Discussion',
                'question': 'Looking at the specific evidence (exit price above entry, 3-minute duration, 0.25% loss), what does this tell us? Debate the significance of these facts.',
                'participants': ['Technical_Analyst', 'Risk_Manager', 'Market_Timer']
            },
            {
                'topic': 'Solution Debate',
                'question': 'What should be done differently next time? Discuss and debate the most important improvements needed.',
                'participants': ['Technical_Analyst', 'Risk_Manager', 'Market_Timer']
            }
        ]
        
        for round_info in discussion_topics:
            print(f"    🎯 {round_info['topic']}...")
            round_discussion = self._run_discussion_round(context, round_info)
            discussion_rounds.append({
                'topic': round_info['topic'],
                'discussion': round_discussion
            })
            
            # Add this round to context for next round
            context += f"\n\nDISCUSSION - {round_info['topic']}:\n"
            for entry in round_discussion:
                context += f"{entry['agent']}: {entry['response']}\n"
        
        return discussion_rounds
    
    def _run_discussion_round(self, context: str, round_info: Dict) -> List[Dict]:
        """Run a single discussion round between specific agents"""
        round_discussion = []
        
        for agent_key in round_info['participants']:
            agent_info = self.agents[agent_key]
            
            # Build discussion prompt
            previous_responses = ""
            if round_discussion:
                previous_responses = "\nPREVIOUS RESPONSES IN THIS DISCUSSION:\n"
                for resp in round_discussion:
                    previous_responses += f"{resp['agent']}: {resp['response']}\n"
            
            prompt = f"""
{agent_info['persona']}

{context}
{previous_responses}

DISCUSSION QUESTION: {round_info['question']}

Respond to the question above. You can:
- Present your view with evidence
- Challenge or agree with others' points
- Build on previous responses
- Disagree respectfully with specific reasons

Keep your response focused and under 200 words.
"""
            
            try:
                response = self.client.chat.completions.create(
                    model="mistralai/mistral-small-3.2-24b-instruct:free",
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=300
                )
                
                response_text = response.choices[0].message.content
                round_discussion.append({
                    'agent': agent_info['name'],
                    'response': response_text
                })
                
                self.discussion_history.append(f"**{round_info['topic']} - {agent_info['name']}**: {response_text}")
                
            except Exception as e:
                round_discussion.append({
                    'agent': agent_info['name'],
                    'response': f"Response failed: {e}"
                })
        
        return round_discussion
    
    def _get_judge_verdict(self, trade_summary: str, initial_analyses: Dict, discussion_rounds: List[Dict]) -> str:
        """Judge synthesizes all discussion to reach final verdict"""
        print("    ⚖️ Dr. Chen synthesizing all perspectives...")
        
        # Compile all discussion
        full_discussion = f"""
TRADE TO JUDGE:
{trade_summary}

INITIAL SPECIALIST ANALYSES:
"""
        for agent_key, analysis in initial_analyses.items():
            full_discussion += f"\n{analysis['agent']}: {analysis['analysis']}\n"
        
        full_discussion += "\nDISCUSSION ROUNDS:\n"
        for round_data in discussion_rounds:
            full_discussion += f"\n{round_data['topic']}:\n"
            for entry in round_data['discussion']:
                full_discussion += f"  {entry['agent']}: {entry['response']}\n"
        
        judge_prompt = f"""
{self.agents['Judge_Expert']['persona']}

You have listened to the complete discussion about this losing trade. Now provide your final verdict.

{full_discussion}

Based on ALL the evidence and discussion above, provide your final judgment:

1. PRIMARY CAUSE: What was the single most important reason this trade lost money? (Choose ONE and defend it)

2. EVIDENCE ANALYSIS: What key evidence from the trade data supports your conclusion?

3. SPECIALIST ASSESSMENT: Which specialist made the strongest arguments? Any weak points to address?

4. FINAL RECOMMENDATIONS: What are the top 3 specific changes needed to prevent this type of loss?

5. CONFIDENCE LEVEL: How confident are you in this analysis? (High/Medium/Low and why)

Be decisive and provide specific, actionable conclusions. This is your final ruling.
"""
        
        try:
            response = self.client.chat.completions.create(
                model="mistralai/mistral-small-3.2-24b-instruct:free",
                messages=[{"role": "user", "content": judge_prompt}],
                max_tokens=600
            )
            
            verdict = response.choices[0].message.content
            self.discussion_history.append(f"**FINAL VERDICT - Dr. Chen**: {verdict}")
            return verdict
            
        except Exception as e:
            return f"Judge verdict failed: {e}"

class LogTradeParser:
    """Simple parser for trading log files"""
    
    def parse_log_file(self, log_file_path: str) -> List[Dict]:
        """Parse log file and extract losing trades"""
        try:
            with open(log_file_path, 'r') as f:
                lines = f.readlines()
            
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
                
                # Extract P&L
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

def display_discussion_results(result: Dict):
    """Display the multi-agent discussion in a readable format"""
    trade = result["trade_data"]
    
    print("\n" + "=" * 90)
    print(f"🎯 MULTI-AGENT DISCUSSION: {trade['symbol']} LOSS ANALYSIS")
    print("=" * 90)
    
    print(f"\n📊 TRADE DETAILS:")
    print(f"   Entry: {trade['entry_time']} at ₹{trade['entry_price']}")
    print(f"   Exit:  {trade['exit_time']} at ₹{trade['exit_price']}")
    print(f"   Duration: {trade['hold_time']} | P&L: ₹{trade['pnl_amount']} ({trade['pnl_percentage']}%)")
    print(f"   Exit Reason: {trade['exit_reason']}")
    
    print(f"\n" + "=" * 90)
    print("📋 ROUND 1: INITIAL SPECIALIST ANALYSES")
    print("=" * 90)
    
    for agent_key, analysis in result["round_1_analyses"].items():
        print(f"\n🔍 {analysis['agent']}:")
        print("-" * 60)
        print(analysis['analysis'])
    
    print(f"\n" + "=" * 90)
    print("🗣️ ROUND 2: DISCUSSION & DEBATE")
    print("=" * 90)
    
    for round_data in result["round_2_discussion"]:
        print(f"\n💬 {round_data['topic']}:")
        print("-" * 70)
        for entry in round_data['discussion']:
            print(f"\n{entry['agent']}: {entry['response']}")
    
    print(f"\n" + "=" * 90)
    print("⚖️ ROUND 3: JUDGE FINAL VERDICT")
    print("=" * 90)
    print(result["round_3_verdict"])
    
    print("\n" + "=" * 90)

def save_final_verdict_md(discussion_result: Dict, verdict_file: str):
    """Save the final verdict as a clean markdown file with enhanced data"""
    trade = discussion_result["trade_data"]
    verdict = discussion_result["round_3_verdict"]
    enhanced_data = discussion_result.get("enhanced_data", {})
    
    # Create markdown content
    md_content = f"""# Trade Loss Analysis - Enhanced Final Verdict

## 📊 Trade Summary
**Symbol:** {trade['symbol']}  
**Entry:** {trade['entry_time']} at ₹{trade['entry_price']}  
**Exit:** {trade['exit_time']} at ₹{trade['exit_price']}  
**Duration:** {trade['hold_time']} ({trade['hold_time_minutes']} minutes)  
**P&L:** ₹{trade['pnl_amount']} ({trade['pnl_percentage']}%)  
**Exit Reason:** {trade['exit_reason']}  
"""
    
    # Add enhanced analysis if available
    if enhanced_data.get('historical_data_available'):
        tech_data = enhanced_data.get('technical_indicators', {})
        wider_stop = enhanced_data.get('wider_stop_analysis', {})
        
        md_content += f"""
## 📈 Enhanced Technical Analysis
**Data Points:** {enhanced_data.get('data_points', 0)} ({enhanced_data.get('date_range', 'N/A')})  
**RSI:** {tech_data.get('current_rsi', 'N/A'):.1f}  
**VWAP:** ₹{tech_data.get('current_vwap', 0):.2f}  
**20-SMA:** ₹{tech_data.get('sma_20', 0):.2f}  
**Support Levels:** {', '.join([f'₹{level:.2f}' for level in tech_data.get('support_levels', [])[:3]])}  
**Resistance Levels:** {', '.join([f'₹{level:.2f}' for level in tech_data.get('resistance_levels', [])[:3]])}  

## 🎯 Wider Stop Loss Analysis (0.5% vs 0.25%)
**Wider Stop Price:** ₹{wider_stop.get('wider_stop_price', 0):.2f}  
**Would Be Hit:** {'YES' if wider_stop.get('wider_stop_hit') else 'NO'}  
**Max High Reached:** ₹{wider_stop.get('max_high', 0):.2f}  
**Max Potential Profit:** {wider_stop.get('max_profit_pct', 0):.2f}%  
**Peak Time:** {wider_stop.get('max_high_time', 'N/A')}  

### Price Performance at Key Intervals
"""
        
        intervals_data = wider_stop.get('price_at_intervals', {})
        for interval, data in intervals_data.items():
            md_content += f"**After {interval}:** ₹{data['price']:.2f} ({data['profit_pct']:+.2f}%)  \n"
    
    else:
        md_content += f"""
## 📈 Enhanced Analysis  
*Not available: {enhanced_data.get('error', 'Data fetch failed')}*
"""
    
    md_content += f"""
## ⚖️ Judge Expert Final Verdict

{verdict}

---
*Enhanced analysis completed on {discussion_result['analyzed_at'][:19]}*
"""
    
    # Write to file
    with open(verdict_file, 'w', encoding='utf-8') as f:
        f.write(md_content)

def main():
    """Main function"""
    if len(sys.argv) < 2:
        print("Usage: python multi_agent_trade_discussion.py <log_file.log> [trade_index]")
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
        print(f"  {i+1}. {trade['symbol']} - {trade['entry_time']} - P&L: ₹{trade['pnl_amount']:.0f}")
    
    # Select trade
    if trade_index is None:
        # Auto-select first trade for testing
        trade_index = 1
        print(f"\n🤖 Auto-selecting trade 1 for testing")
    
    if trade_index < 1 or trade_index > len(losing_trades):
        print("❌ Invalid trade index")
        return
    
    selected_trade = losing_trades[trade_index - 1]
    print(f"\n🎯 Multi-agent analysis starting for: {selected_trade['symbol']}")
    
    # Run multi-agent discussion
    analyzer = MultiAgentTradeDiscussion()
    discussion_result = analyzer.analyze_trade_with_discussion(selected_trade)
    
    # Display results
    display_discussion_results(discussion_result)
    
    # Save results (convert DataFrames to dict for JSON serialization)
    output_file = f"discussion_analysis_{selected_trade['symbol']}_{selected_trade['trade_date'].replace('-', '')}.json"
    
    # Convert DataFrames to dict before JSON serialization
    json_safe_result = {}
    for key, value in discussion_result.items():
        if hasattr(value, 'to_dict'):  # DataFrame
            json_safe_result[key] = value.to_dict('records')
        else:
            json_safe_result[key] = value
    
    with open(output_file, 'w') as f:
        json.dump(json_safe_result, f, indent=2)
    
    # Save final verdict as markdown
    log_name = os.path.basename(log_file).replace('.log', '')
    verdict_file = f"{log_name}_final_verdict.md"
    save_final_verdict_md(discussion_result, verdict_file)
    
    print(f"\n📄 Full discussion transcript saved to: {output_file}")
    print(f"⚖️ Final verdict saved to: {verdict_file}")

if __name__ == "__main__":
    main()

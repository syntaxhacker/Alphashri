import pandas as pd
import matplotlib.pyplot as plt

def plot_backtest_results(df: pd.DataFrame, trades_df: pd.DataFrame, title: str = 'Backtest Results') -> None:
    """Plot backtest results with price, trades, and performance metrics"""
    # Create figure with secondary y-axis
    fig = plt.figure(figsize=(15, 10))
    ax1 = fig.add_subplot(211)
    ax2 = fig.add_subplot(212)
    
    # Plot price
    df['close'].plot(ax=ax1, color='blue', label='Price')
    
    # Plot trades
    if not trades_df.empty:
        # Plot buy points
        buy_trades = trades_df[trades_df['action'] == 'BUY']
        ax1.scatter(buy_trades.index, buy_trades['price'], 
                   marker='^', color='green', label='Buy', s=100)
        
        # Plot sell points
        sell_trades = trades_df[trades_df['action'] == 'SELL']
        ax1.scatter(sell_trades.index, sell_trades['price'], 
                   marker='v', color='red', label='Sell', s=100)
        
        # Plot cumulative returns
        trades_df['cumulative_return'].plot(ax=ax2, color='blue', label='Cumulative Return (%)')
    
    # Customize price plot
    ax1.set_title(f'{title} - Trading Signals')
    ax1.set_xlabel('Date')
    ax1.set_ylabel('Price')
    ax1.legend()
    ax1.grid(True)
    
    # Customize returns plot
    ax2.set_title('Cumulative Returns')
    ax2.set_xlabel('Date')
    ax2.set_ylabel('Return (%)')
    ax2.legend()
    ax2.grid(True)
    
    plt.tight_layout()
    plt.show() 
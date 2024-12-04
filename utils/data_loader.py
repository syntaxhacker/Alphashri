import pandas as pd
from datetime import datetime
import os

def load_stock_data():
    """Load and prepare stock data"""
    data = {
        'multibagger_df': None,
        'undervalued_df': None,
        'multibagger_date': "No Data",
        'undervalued_date': "No Data"
    }
    
    try:
        # Load multibagger data
        mb_files = [f for f in os.listdir() if f.startswith('potential_multibaggers_')]
        if mb_files:
            latest_mb = max(mb_files)
            data['multibagger_df'] = pd.read_csv(latest_mb)
            date_str = latest_mb.split('_')[2]
            data['multibagger_date'] = datetime.strptime(
                date_str, '%Y%m%d').strftime('%d-%b-%Y')
        
        # Load undervalued data
        uv_files = [f for f in os.listdir() if f.startswith('undervalued_stocks_')]
        if uv_files:
            latest_uv = max(uv_files)
            data['undervalued_df'] = pd.read_csv(latest_uv)
            date_str = latest_uv.split('_')[2]
            data['undervalued_date'] = datetime.strptime(
                date_str, '%Y%m%d').strftime('%d-%b-%Y')
            
    except Exception as e:
        print(f"Error loading data: {str(e)}")
    
    return data 
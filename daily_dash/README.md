# Trading Dashboard Generator

A Python-based trading dashboard that reads log files, processes trade data, and generates a standalone HTML dashboard with interactive charts.

## Features

- **Log File Processing**: Parses trade log files with entry/exit data
- **Interactive Charts**: Real-time P&L charts using ECharts
- **Trade Summary**: Statistics, win rates, and top wins/losses
- **Responsive Design**: Works on desktop and mobile devices
- **Standalone HTML**: Generates a single HTML file that can be opened in any browser
- **Improved Tooltips**: Detailed and easy-to-read tooltips for entry and exit markers
- **ASCII Tooltip Representation**: Clear ASCII representation of tooltips in the README

## Project Structure

```
dashboard/
├── config.py              # Configuration settings
├── requirements.txt       # Python dependencies
├── README.md             # This file
├── template/             # HTML templates
│   └── index.html        # Main dashboard template
├── helpers/              # Python helper modules
│   ├── log_parser.py     # Log file parsing logic
│   └── trade_processor.py # Trade processing and calculations
├── scripts/              # Python scripts
│   └── generate_dashboard.py # Main dashboard generator
├── public/               # Generated output
│   └── dashboard.html    # Final dashboard HTML
└── test.log              # Sample log file (input)
```

## Installation

1. **Clone or download the project**
2. **Install Python dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

## Usage

### Generate the Dashboard

Run the main script to generate the dashboard:

```bash
python scripts/generate_dashboard.py
```

This will:
1. Read the log file specified in `config.py`
2. Parse and process the trade data
3. Render the HTML template
4. Save the final dashboard to `public/dashboard.html`

### View the Dashboard

Open the generated HTML file in your browser:
```bash
open public/dashboard.html
```

Or navigate to the file in your web browser.

## Configuration

Edit `config.py` to customize:

- **Log File Path**: `LOG_FILE_PATH`
- **Template Path**: `TEMPLATE_PATH`
- **Output Path**: `OUTPUT_PATH`
- **Chart Settings**: Dimensions, colors, etc.
- **Display Settings**: Maximum trades to show, time ranges, etc.

### Example Configuration

```python
class Config:
    LOG_FILE_PATH = 'path/to/your/logfile.log'
    TEMPLATE_PATH = 'template/index.html'
    OUTPUT_PATH = 'public/dashboard.html'
    MAX_TRADES_TO_SHOW = 100
    TRADING_START_HOUR = 9
    TRADING_END_HOUR = 15
```

## Log File Format

The system expects log files in the following format:

```
# Old TV Screener Trade Journal - OLD_SCREENER Mode
# Started: 2025-08-08 12:16:26
# Format: TIMESTAMP | ACTION | SYMBOL | PRICE | QTY | AMOUNT | ALERT_TYPE | P&L
--------------------------------------------------------------------------------
2025-08-08 12:17:43 | ENTRY | NSE:BGRENERGY | ₹126.82 | 157 | ₹19,911 | PRICE_MOVE|trend:neutral
2025-08-08 12:22:02 | EXIT | NSE:EPACK | ₹402.75 | 49 | ₹19,735 | STOP LOSS: -0.59% | P&L: -0.59% (₹-117)
```

### Log Format Details

- **TIMESTAMP**: Date and time in `YYYY-MM-DD HH:MM:SS` format
- **ACTION**: `ENTRY` or `EXIT`
- **SYMBOL**: Stock symbol (e.g., `NSE:BGRENERGY`)
- **PRICE**: Entry/exit price with ₹ symbol
- **QTY**: Quantity of shares
- **AMOUNT**: Total amount with ₹ symbol
- **ALERT_TYPE**: Exit reason or alert type
- **P&L**: Profit/loss information (for EXIT trades only)

## Dashboard Features

### Header Statistics
- **Total P&L**: Cumulative profit/loss
- **Total Trades**: Number of completed trades
- **Win Rate**: Percentage of winning trades

### Main Chart
- **Interactive P&L Chart**: Shows cumulative P&L over time
- **Entry/Exit Markers**: Visual indicators for trade entries and exits
- **Zoom Controls**: Zoom and pan functionality
- **Tooltips**: Detailed information on hover

### Recent Trades Table
- **Trade Details**: Symbol, entry/exit times, prices, quantities
- **P&L Display**: Percentage and absolute P&L for each trade
- **Exit Reasons**: Color-coded exit reasons
- **Responsive Design**: Adapts to different screen sizes

### Summary Sections
- **Top 10 Wins**: Best performing trades
- **Top 10 Losses**: Worst performing trades

## Customization

### Adding New Alert Types

Edit the `get_alert_class` function in `scripts/generate_dashboard.py`:

```python
def get_alert_class(exit_reason):
    if 'your_new_alert' in exit_reason.lower():
        return 'alert-your-class'
    # ... existing logic
```

### Modifying Chart Appearance

Edit the chart configuration in `public/chart.js` within the `renderChart()` function.

### Tooltip Previews

Here is an ASCII representation of what the tooltips look like on the chart:

**Entry Marker Tooltip**
```
+-------------------------------------------+
| ▲ ENTRY - RELIANCE                        |
|-------------------------------------------|
| Time:          09:30:15                   |
| Symbol:        NSE:RELIANCE               |
| Action:        ENTRY                      |
| Entry Price:   ₹2500.00                   |
| Quantity:      10                         |
+-------------------------------------------+
```

**Exit Marker Tooltip (Profit)**
```
+-------------------------------------------+
| ▼ EXIT - RELIANCE (Profit)                |
|-------------------------------------------|
| Time:          14:15:45                   |
| Symbol:        NSE:RELIANCE               |
| Action:        EXIT                       |
| Exit Price:    ₹2550.00                   |
| Quantity:      10                         |
| Trade P&L:     +₹500.00                   |
| Cumulative P&L: +₹1500.00                  |
| Exit Reason:   TARGET ACHIEVED            |
+-------------------------------------------+
```

**Exit Marker Tooltip (Loss)**
```
+-------------------------------------------+
| ▼ EXIT - INFY (Loss)                      |
|-------------------------------------------|
| Time:          11:45:10                   |
| Symbol:        NSE:INFY                   |
| Action:        EXIT                       |
| Exit Price:    ₹1450.00                   |
| Quantity:      15                         |
| Trade P&L:     -₹225.00                   |
| Cumulative P&L: +₹1275.00                  |
| Exit Reason:   STOP LOSS                  |
+-------------------------------------------+
```

### Adding New Statistics

Update the `calculate_summary_stats` function in `helpers/trade_processor.py` and add the new fields to the template.

## Troubleshooting

### Common Issues

1. **"No trades found"**: Check that the log file exists and has the correct format
2. **Template errors**: Ensure all required Jinja2 variables are provided
3. **Missing dependencies**: Run `pip install -r requirements.txt`
4. **File permissions**: Ensure the script has write access to the output directory

### Debug Mode

Add debug prints to the script to trace data processing:

```python
print(f"Processing {len(raw_trades)} raw trades...")
print(f"Sample trade: {raw_trades[0]}")
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is open source and available under the MIT License.

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review the log file format requirements
3. Verify configuration settings
4. Test with sample data

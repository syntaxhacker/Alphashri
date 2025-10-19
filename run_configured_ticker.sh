#!/bin/bash
# Script to run the installed ticker with your configuration

echo "🚀 Running Ticker with Your Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if ticker is installed
if ! command -v ticker &> /dev/null; then
    echo "❌ Ticker not found in PATH"
    echo ""
    echo "💡 To add ticker to your PATH:"
    echo "  echo 'export PATH=\"/opt/homebrew/Cellar/ticker/5.0.7/bin:\$PATH\"' >> ~/.zshrc"
    echo "  source ~/.zshrc"
    echo ""
    echo "Or run directly:"
    echo "  /opt/homebrew/Cellar/ticker/5.0.7/bin/ticker --config ticker/.ticker.yaml"
    exit 1
fi

echo "✅ Ticker found: $(which ticker)"
echo ""

# Copy config to home directory if not exists
if [ ! -f ~/.ticker.yaml ]; then
    echo "📋 Copying configuration to ~/.ticker.yaml"
    cp ticker/.ticker.yaml ~/.ticker.yaml
    echo "✅ Configuration copied"
else
    echo "✅ Configuration already exists at ~/.ticker.yaml"
fi

echo ""
echo "🎯 Your ticker configuration:"
echo "  • Watchlist: RELIANCE, TCS, INFY, HDFC, ICICI + more"
echo "  • Groups: Large Cap, Banking, Auto"
echo "  • Positions: Your existing holdings"
echo "  • Currency: INR"
echo "  • Refresh: 3 seconds"
echo ""

echo "🚀 Starting ticker..."
echo "💡 Controls: TAB=switch groups, ↑↓=scroll, q=quit"
echo ""

# Run ticker with your config
ticker --config ~/.ticker.yaml
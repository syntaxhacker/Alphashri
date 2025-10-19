#!/bin/bash
# Script to install and run the ticker application using Homebrew

cd "$(dirname "$0")"

echo "🚀 Ticker - Terminal Stock Tracker"
echo "📊 Professional terminal-based portfolio tracker"
echo ""
echo "💡 Installing with Homebrew (easiest method)..."
echo ""

# Check if Homebrew is installed
if ! command -v brew &> /dev/null; then
    echo "❌ Homebrew not found!"
    echo ""
    echo "💡 To install Homebrew:"
    echo "  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
    echo ""
    echo "Then run this script again."
    exit 1
fi

echo "✅ Homebrew found"

# Install ticker using Homebrew
echo "📦 Installing ticker..."
if brew install achannarasappa/tap/ticker; then
    echo "✅ Ticker installed successfully!"
else
    echo "❌ Installation failed"
    echo "💡 Try manually: brew install achannarasappa/tap/ticker"
    exit 1
fi

echo ""
echo "🎯 Setup Information:"
echo "━━━━━━━━━━━━━━━━━━━━━"
echo "📁 Config file: ~/.ticker.yaml (will be created)"
echo "🎯 Watchlist: RELIANCE, TCS, INFY, HDFC, ICICI + more"
echo "💰 Positions: Your existing holdings with cost basis"
echo "🌍 Currency: INR"
echo "⏰ Refresh: 3 seconds"
echo ""
echo "🚀 Ready to run!"
echo ""
echo "To start ticker:"
echo "  ticker"
echo ""
echo "Or with your config:"
echo "  ticker --config ~/.ticker.yaml"
echo ""
echo "🎮 Controls:"
echo "  TAB       - Switch between groups"
echo "  ↑/↓       - Scroll through stocks"
echo "  q/Esc     - Quit"
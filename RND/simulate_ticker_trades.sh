#!/bin/bash
# Script to simulate different trading scenarios with ticker

echo "🚀 Ticker - Trading Scenario Simulator"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if ticker is available
if ! command -v ticker &> /dev/null; then
    echo "❌ Ticker not found in PATH"
    echo ""
    echo "💡 To add ticker to your PATH:"
    echo "  export PATH=\"/opt/homebrew/Cellar/ticker/5.0.7/bin:\$PATH\""
    echo ""
    echo "Or run directly:"
    echo "  /opt/homebrew/Cellar/ticker/5.0.7/bin/ticker --config ticker/trading_scenarios.yaml"
    exit 1
fi

echo "✅ Ticker found: $(which ticker)"
echo ""

# Function to run a trading scenario
run_scenario() {
    local scenario=$1
    local description=$2

    echo "📊 Scenario: $scenario"
    echo "💡 $description"
    echo ""

    echo "🚀 Starting ticker for scenario: $scenario"
    echo "Press Ctrl+C to stop and try next scenario"
    echo ""

    # Copy the appropriate config section to main config
    case $scenario in
        "bull")
            echo "📈 Bull Market Scenario - All positions profitable"
            cp ~/.ticker.yaml ~/.ticker.yaml.backup 2>/dev/null || true
            # Use the bull market config (you'd modify .ticker.yaml for this)
            ;;
        "bear")
            echo "📉 Bear Market Scenario - Testing loss management"
            ;;
        "mixed")
            echo "⚖️ Mixed Portfolio - Diversified holdings"
            ;;
        "hft")
            echo "⚡ HFT Simulation - Large position sizes"
            ;;
        "options")
            echo "🎯 Options Trading - Multiple cost basis lots"
            ;;
    esac

    echo "🎮 Controls during simulation:"
    echo "  TAB       - Switch between groups"
    echo "  ↑/↓       - Scroll through stocks"
    echo "  Ctrl+C    - Stop and return to menu"
    echo ""

    # Run ticker with the scenario config
    ticker --config ~/.ticker.yaml

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# Main menu
while true; do
    echo "🎯 Choose a trading scenario to simulate:"
    echo ""
    echo "1) 📈 Bull Market (All positions profitable)"
    echo "2) 📉 Bear Market (Some positions losing)"
    echo "3) ⚖️ Mixed Portfolio (Diversified holdings)"
    echo "4) ⚡ HFT Simulation (Large positions)"
    echo "5) 🎯 Options Trading (Multiple cost basis)"
    echo "6) 🚪 Exit"
    echo ""
    read -p "Enter your choice (1-6): " choice

    case $choice in
        1)
            run_scenario "bull" "Simulate profitable positions in rising market"
            ;;
        2)
            run_scenario "bear" "Test loss management and stop-loss strategies"
            ;;
        3)
            run_scenario "mixed" "Balanced portfolio with mixed performance"
            ;;
        4)
            run_scenario "hft" "Large position sizes for high-frequency simulation"
            ;;
        5)
            run_scenario "options" "Multiple cost basis lots for averaging simulation"
            ;;
        6)
            echo "👋 Goodbye!"
            exit 0
            ;;
        *)
            echo "❌ Invalid choice. Please select 1-6."
            echo ""
            ;;
    esac
done
#!/bin/bash

# Ngrok setup and management script for TradingView webhook

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

PORT=5000

echo -e "${GREEN}TradingView Webhook Ngrok Setup${NC}"

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo -e "${RED}ngrok is not installed${NC}"
    echo "Installing ngrok..."
    
    # Detect OS
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &> /dev/null; then
            brew install ngrok/ngrok/ngrok
        else
            echo "Please install Homebrew first or download ngrok manually from https://ngrok.com/download"
            exit 1
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        wget https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz
        tar xvzf ngrok-v3-stable-linux-amd64.tgz
        sudo mv ngrok /usr/local/bin
        rm ngrok-v3-stable-linux-amd64.tgz
    else
        echo "Unsupported OS. Please install ngrok manually from https://ngrok.com/download"
        exit 1
    fi
fi

# Check if ngrok is configured
if [ ! -f ~/.config/ngrok/ngrok.yml ] && [ ! -f ~/.ngrok2/ngrok.yml ]; then
    echo -e "${YELLOW}ngrok is not configured${NC}"
    echo "Please get your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken"
    read -p "Enter your ngrok authtoken: " AUTHTOKEN
    ngrok config add-authtoken "$AUTHTOKEN"
fi

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}Creating virtual environment...${NC}"
    python3 -m venv venv
fi

# Activate virtual environment and install dependencies
echo -e "${GREEN}Setting up virtual environment...${NC}"
source venv/bin/activate
pip install -q flask

# Function to start services
start_services() {
    echo -e "${GREEN}Starting TradingView webhook server...${NC}"
    source venv/bin/activate
    python tradingview_webhook.py &
    WEBHOOK_PID=$!
    echo "Webhook server PID: $WEBHOOK_PID"
    
    sleep 2
    
    echo -e "${GREEN}Starting ngrok tunnel...${NC}"
    ngrok http $PORT &
    NGROK_PID=$!
    echo "Ngrok PID: $NGROK_PID"
    
    sleep 3
    
    # Get ngrok URL
    NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | grep -o 'https://[^"]*' | head -1)
    
    if [ -z "$NGROK_URL" ]; then
        echo -e "${RED}Failed to get ngrok URL${NC}"
        kill $WEBHOOK_PID $NGROK_PID 2>/dev/null
        exit 1
    fi
    
    echo -e "${GREEN}=== SERVICES RUNNING ===${NC}"
    echo "Webhook URL: ${NGROK_URL}/webhook"
    echo "Dashboard: http://localhost:4040"
    echo ""
    echo "Use this URL in TradingView: ${NGROK_URL}/webhook"
    echo ""
    echo "Press Ctrl+C to stop all services"
    
    # Save PIDs for cleanup
    echo $WEBHOOK_PID > .webhook_pid
    echo $NGROK_PID > .ngrok_pid
    
    # Wait for interrupt
    trap 'cleanup' INT
    wait
}

# Function to stop services
cleanup() {
    echo -e "\n${YELLOW}Stopping services...${NC}"
    
    if [ -f .webhook_pid ]; then
        WEBHOOK_PID=$(cat .webhook_pid)
        kill $WEBHOOK_PID 2>/dev/null
        rm .webhook_pid
    fi
    
    if [ -f .ngrok_pid ]; then
        NGROK_PID=$(cat .ngrok_pid)
        kill $NGROK_PID 2>/dev/null
        rm .ngrok_pid
    fi
    
    # Kill any remaining processes
    pkill -f "python tradingview_webhook.py" 2>/dev/null
    pkill -f "ngrok http" 2>/dev/null
    
    echo -e "${GREEN}Services stopped${NC}"
    exit 0
}

# Function to show status
show_status() {
    if pgrep -f "python tradingview_webhook.py" > /dev/null; then
        echo -e "${GREEN}Webhook server is running${NC}"
    else
        echo -e "${RED}Webhook server is not running${NC}"
    fi
    
    if pgrep -f "ngrok http" > /dev/null; then
        echo -e "${GREEN}Ngrok tunnel is running${NC}"
        NGROK_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -o 'https://[^"]*' | head -1)
        if [ ! -z "$NGROK_URL" ]; then
            echo "Webhook URL: ${NGROK_URL}/webhook"
        fi
    else
        echo -e "${RED}Ngrok tunnel is not running${NC}"
    fi
}

# Main menu
case "${1:-start}" in
    start)
        start_services
        ;;
    stop)
        cleanup
        ;;
    status)
        show_status
        ;;
    *)
        echo "Usage: $0 {start|stop|status}"
        echo "  start  - Start webhook server and ngrok tunnel"
        echo "  stop   - Stop all services"
        echo "  status - Show service status"
        exit 1
        ;;
esac
#!/bin/bash

echo "🚀 Starting Stock Backtesting Platform..."
echo "========================================="

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check dependencies
echo "📋 Checking dependencies..."

if ! command_exists python3; then
    echo "❌ Python 3 is required but not installed."
    exit 1
fi

if ! command_exists bun; then
    echo "❌ Bun is required but not installed."
    echo "💡 Install Bun: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

echo "✅ Dependencies check passed!"

# Install backend dependencies
echo ""
echo "📦 Installing backend dependencies..."
if [ -f "requirements.txt" ]; then
    pip install -r requirements.txt
    echo "✅ Backend dependencies installed!"
else
    echo "⚠️ requirements.txt not found, skipping backend setup"
fi

# Install frontend dependencies
echo ""
echo "📦 Installing frontend dependencies..."
cd stock-backtester
if [ -f "package.json" ]; then
    bun install
    echo "✅ Frontend dependencies installed!"
    cd ..
else
    echo "❌ package.json not found"
    exit 1
fi

echo ""
echo "🚀 Starting servers..."
echo "Backend will run on http://localhost:8000"
echo "Frontend will run on http://localhost:5173"
echo ""

# Kill any existing processes on these ports
echo "🧹 Cleaning up any existing processes..."
pkill -f "backend_api.py" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
pkill -f "bun" 2>/dev/null || true

# Start backend in background
echo "🔧 Starting FastAPI backend..."
python backend_api.py &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 3

# Start frontend in background
echo "⚛️ Starting React frontend with Bun..."
cd stock-backtester
bun dev &
FRONTEND_PID=$!

cd ..

echo ""
echo "✅ Both servers are starting up!"
echo "📊 Backend API: http://localhost:8000"
echo "🌐 Frontend App: http://localhost:5173"
echo "📚 API Docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both servers"

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down servers..."
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    pkill -f "backend_api.py" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true
    pkill -f "bun" 2>/dev/null || true
    echo "✅ Cleanup complete!"
    exit 0
}

# Set trap to cleanup on script exit
trap cleanup INT TERM

# Wait for user to stop
wait 
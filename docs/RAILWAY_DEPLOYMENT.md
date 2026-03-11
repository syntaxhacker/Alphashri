# 🚀 Railway Deployment Guide for Trading Bot

This guide explains how to deploy your centralized trading configuration system to Railway.

## 📋 Prerequisites

1. **Railway Account**: Sign up at [railway.app](https://railway.app)
2. **GitHub Repository**: Push your code to GitHub
3. **Environment Configuration**: Set up your trading parameters

## 🔧 Deployment Files Created

### Core Files
- `Dockerfile` - Container configuration with TA-Lib support
- `railway_app.py` - Web dashboard and health monitoring
- `railway.json` - Railway deployment settings
- `requirements_railway.txt` - Optimized dependencies for cloud deployment
- `.env.example` - Environment variables template

## 🚀 Quick Deployment Steps

### 1. Push to GitHub
```bash
git add .
git commit -m "Add Railway deployment configuration"
git push origin main
```

### 2. Deploy to Railway
1. Go to [railway.app](https://railway.app)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your repository
5. Railway will automatically detect the `Dockerfile` and deploy

### 3. Configure Environment Variables
In Railway dashboard, go to your project → Variables tab and set:

```bash
# Required
PAPER_TRADING_ENABLED=true
MARKET=in
TRADING_MODE=volume_spike_monitor

# Optional Trading Configuration
TRADING_START_TIME=09:20
TRADING_END_TIME=15:30
STOP_LOSS_PCT=-0.5
TAKE_PROFIT_PCT=0.4
MAX_DAILY_ENTRIES=2

# Optional Telegram (for alerts)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
TELEGRAM_ENABLED=false

# System
LOG_LEVEL=INFO
ENVIRONMENT=production
```

### 4. Access Your Dashboard
Once deployed, Railway will provide a URL like: `https://your-app.railway.app`

## 🎛️ Trading Modes Available

Set `TRADING_MODE` to one of:
- `volume_spike_monitor` - Monitor volume spikes (recommended)
- `price_move_alerts` - Track significant price movements  
- `smart_fomo_detector` - Detect FOMO opportunities
- `overbought_short_signals` - Short overbought stocks
- `heavy_breakout` - Heavy volume breakouts
- `intraday_breakouts` - Standard intraday breakouts

## 📊 Web Dashboard Features

Your deployed app includes:
- **Real-time Status**: Bot running status and health
- **Configuration Display**: Current trading parameters
- **Health Checks**: Automatic monitoring endpoints
- **API Endpoints**: 
  - `/api/health` - Health check
  - `/api/status` - Bot status
  - `/api/start` - Start bot (POST)
  - `/api/stop` - Stop bot (POST)

## 🔒 Security Features

### Environment Variables
All sensitive data is stored in Railway environment variables:
- API keys and tokens
- Trading configuration
- System settings

### Paper Trading Default
The deployment defaults to **paper trading mode** for safety:
```bash
PAPER_TRADING_ENABLED=true  # Always start with paper trading
```

### Risk Management
Built-in safety features from `tv_configs.py`:
- Configurable stop losses
- Daily entry limits
- ATR-based stops for volatile stocks
- Ultra-tight trailing stops

## 🔧 Configuration System

The deployment uses the centralized `tv_configs.py` system:

### Default Configuration
```python
# Runs with balanced default settings
TVScreenerUsage(enable_paper_trading=True)
```

### Environment Override Example
```python
# Environment variables automatically override defaults
STOP_LOSS_PCT=-0.3  # Tighter than default -0.5%
TAKE_PROFIT_PCT=0.6  # Higher than default 0.4%
```

## 📈 Monitoring

### Health Checks
Railway automatically monitors:
- Container health via `/api/health`
- Application responsiveness
- Memory and CPU usage

### Logs
View real-time logs in Railway dashboard:
- Trading decisions
- Market analysis
- Error handling
- Performance metrics

## 🚨 Safety Checklist

- [ ] **Paper Trading Enabled**: Verify `PAPER_TRADING_ENABLED=true`
- [ ] **Start Small**: Begin with conservative settings
- [ ] **Monitor Logs**: Watch for errors or unexpected behavior
- [ ] **Test Configuration**: Verify all trading parameters
- [ ] **Backup Settings**: Save your environment configuration

## 🔄 Updates and Scaling

### Code Updates
1. Push changes to GitHub
2. Railway auto-deploys new versions
3. Monitor deployment in Railway dashboard

### Scaling
Railway automatically handles:
- Memory scaling based on usage
- CPU allocation
- Network resources

## 💡 Advanced Features

### Custom Configuration Presets
Override default config via environment:
```bash
# For aggressive trading
TRADING_CONFIG_PRESET=aggressive

# For conservative trading  
TRADING_CONFIG_PRESET=conservative
```

### Multiple Markets
Deploy separate instances for different markets:
```bash
MARKET=in   # Indian market
MARKET=us   # US market
```

## 🐛 Troubleshooting

### Common Issues
1. **TA-Lib Installation**: Dockerfile includes TA-Lib compilation
2. **Memory Limits**: Railway provides sufficient resources
3. **Time Zones**: Container uses `Asia/Kolkata` timezone
4. **Dependencies**: Use `requirements_railway.txt` for optimized packages

### Debug Mode
Enable debug logging:
```bash
LOG_LEVEL=DEBUG
ENVIRONMENT=development
```

## 📞 Support

- **Railway Docs**: [docs.railway.app](https://docs.railway.app)
- **Dashboard**: Access via your Railway app URL
- **Logs**: View in Railway project dashboard
- **Health Check**: `https://your-app.railway.app/api/health`

---

**⚠️ Important**: Always start with paper trading enabled and test thoroughly before considering live trading.
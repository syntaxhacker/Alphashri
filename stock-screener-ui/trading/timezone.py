IST = None
try:
    import config
    IST = config.IST
except ImportError:
    from datetime import timezone, timedelta
    IST = timezone(timedelta(hours=5, minutes=30))

IST = None
try:
    import config
    IST = config.IST
except ImportError:
    # Standalone use (config.py absent from sys.path) still needs a usable IST.
    # This fixed +05:30 offset is byte-identical to config.IST, so callers see
    # the same wall clock on both paths; keep it in lockstep with config.IST.
    from datetime import timezone, timedelta
    IST = timezone(timedelta(hours=5, minutes=30))

#: Canonical IANA name for config.IST. APIs that need a zone *name* (``ZoneInfo``,
#: chart session registries) derive it from here instead of restating a literal.
TZ_IST = "Asia/Kolkata"

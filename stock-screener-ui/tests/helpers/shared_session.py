"""
Shared database-session proxy for tests.

Production helpers that open their own ``SessionLocal`` must not close the
schema-initialized session owned by a test fixture. ``SharedSession`` forwards
every attribute to that test session while making ``close()`` a no-op.
"""


class SharedSession:
    """Proxy the test session so helper-owned ``SessionLocal`` calls cannot close it."""

    def __init__(self, session):
        self._session = session

    def __enter__(self):
        return self._session

    def __exit__(self, *exc_info):
        return False

    def close(self):
        pass

    def __getattr__(self, name):
        return getattr(self._session, name)

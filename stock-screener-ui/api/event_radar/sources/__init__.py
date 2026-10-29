"""Source adapters that turn raw vendor payloads into contract ``Event`` objects.

Each adapter is self-contained and takes an injected HTTP client (anything with
``get``/``post`` plus ``.status_code``/``.json()``/``.text``). Injection is what
keeps the whole suite offline: tests pass recorded-payload fakes instead of
monkey-patching ``requests``.

Adapters never raise on shape drift — a vendor changing a field name must
degrade to "fewer events", not to a 500 on the calendar endpoint. Transport
failures do raise, and the aggregator decides whether one dead feed is fatal.
"""

from __future__ import annotations

__all__: list[str] = []

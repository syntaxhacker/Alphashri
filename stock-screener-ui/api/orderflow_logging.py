"""
Log redaction for broker/transport errors.

Broker SDKs and the ``websockets`` library log the raw HTTP handshake
themselves::

    ERROR websocket: Handshake status 403 Forbidden -+-+- {'set-cookie':
    '__cf_bm=...', 'cf-ray': '...'} -+-+- b''

Those lines never pass through our error handling, so sanitizing adapter
errors is not enough — the values still land in the log (and, for the bridge,
were also pushed to the browser). A logging filter is the only place that sees
every record.

Install once per process, after logging is configured::

    from api.orderflow_logging import install_error_redaction
    install_error_redaction()
"""

import logging

from api.orderflow_adapters.base import redact_sensitive

#: Loggers that are known to echo raw broker/transport failures.
_WATCHED_LOGGERS = (
    "websockets",
    "websocket",
    "fyers_apiv3",
    "uvicorn.error",
    "uvicorn",
)


class RedactBrokerErrorBlob(logging.Filter):
    """Rewrite a record's message when it carries a redactable blob."""

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003 - stdlib name
        try:
            text = record.getMessage()
        except Exception:  # noqa: BLE001 - never break logging
            return True
        cleaned = redact_sensitive(text)
        if cleaned != text:
            # Collapse the lazy %-formatting so the rewritten value is final.
            record.msg = cleaned
            record.args = ()
        return True


_installed = False


def install_error_redaction() -> None:
    """Attach the redacting filter to root + watched handlers/loggers.

    Filters on ancestor *loggers* do not run for propagated records, but handler
    filters do — so root handlers are the reliable interception point, and the
    watched loggers are filtered directly as a second line of defence.
    """
    global _installed
    if _installed:
        return
    _installed = True

    flt = RedactBrokerErrorBlob()

    root = logging.getLogger()
    for handler in root.handlers:
        handler.addFilter(flt)

    for name in _WATCHED_LOGGERS:
        logger = logging.getLogger(name)
        logger.addFilter(flt)
        for handler in logger.handlers:
            handler.addFilter(flt)


def _reset_for_tests() -> None:
    """Allow tests to re-install against fresh handlers."""
    global _installed
    _installed = False

"""Broker/transport error logs must not carry cookies or raw HTTP responses.

The adapter sanitizer only covers errors that flow through our code. The
``websockets`` library logs the failing handshake itself, so a logging filter is
the only thing that can catch those lines.
"""

import logging

import pytest

from api.orderflow_adapters.base import redact_sensitive
from api.orderflow_logging import RedactBrokerErrorBlob, install_error_redaction

RAW = (
    "Handshake status 403 Forbidden -+-+- {'date': 'Thu, 17 Sep 2026 07:31:03 GMT', "
    "'set-cookie': '__cf_bm=SECRETCOOKIEVALUE; HttpOnly; Secure; Path=/', "
    "'cf-ray': 'a3c668b7db28aa6a-MAA', 'server': 'cloudflare'} -+-+- b''"
)


def _record(msg, args=None, name="websockets", level=logging.ERROR):
    return logging.LogRecord(name, level, "path", 1, msg, args, None)


class TestRedactSensitive:
    def test_blob_is_replaced_not_truncated(self):
        out = redact_sensitive(RAW)
        assert out.startswith("Handshake status 403 Forbidden")
        assert "[redacted]" in out
        assert "SECRETCOOKIEVALUE" not in out
        assert "cf-ray" not in out
        assert "-+-+-" not in out

    @pytest.mark.parametrize(
        "text",
        [
            "set-cookie: __cf_bm=abc123; Path=/",
            "'cf-ray': 'abc-MAA'",
            "Authorization: Bearer eyJhbGciOi",
            "access_token=supersecret",
        ],
    )
    def test_bare_header_values_are_redacted(self, text):
        assert "abc" not in redact_sensitive(text) or "[redacted]" in redact_sensitive(text)

    def test_clean_line_is_unchanged(self):
        assert redact_sensitive("orderflow recorder: no tick for SBIN in 19s") == (
            "orderflow recorder: no tick for SBIN in 19s"
        )


class TestRedactFilter:
    def test_rewrites_a_record_carrying_the_blob(self):
        rec = _record(RAW)
        assert RedactBrokerErrorBlob().filter(rec) is True
        assert "SECRETCOOKIEVALUE" not in rec.getMessage()
        assert "[redacted]" in rec.getMessage()

    def test_handles_lazy_percent_formatting(self):
        rec = _record("Handshake %s -+-+- secret-cookie -+-+- b''", ("403 Forbidden",))
        RedactBrokerErrorBlob().filter(rec)
        message = rec.getMessage()
        assert "403 Forbidden" in message
        assert "secret-cookie" not in message

    def test_leaves_clean_records_alone(self):
        rec = _record("orderflow recorder: no tick for SBIN in 19s")
        before = rec.getMessage()
        RedactBrokerErrorBlob().filter(rec)
        assert rec.getMessage() == before

    def test_never_raises_on_a_broken_record(self):
        rec = _record("bad %s %s", ("only-one",))
        # A formatting error must not propagate out of the filter.
        assert RedactBrokerErrorBlob().filter(rec) is True


class TestInstall:
    def test_installs_on_root_handlers_and_watched_loggers(self):
        import api.orderflow_logging as mod

        root = logging.getLogger()
        handler = logging.NullHandler()
        root.addHandler(handler)
        original = set(handler.filters)
        mod._reset_for_tests()
        try:
            install_error_redaction()
            assert any(isinstance(f, RedactBrokerErrorBlob) for f in handler.filters)
            assert any(
                isinstance(f, RedactBrokerErrorBlob)
                for f in logging.getLogger("websockets").filters
            )
        finally:
            handler.filters = [f for f in handler.filters if f in original]
            root.removeHandler(handler)
            mod._reset_for_tests()

    def test_is_idempotent(self):
        import api.orderflow_logging as mod

        handler = logging.NullHandler()
        logging.getLogger().addHandler(handler)
        mod._reset_for_tests()
        try:
            install_error_redaction()
            install_error_redaction()
            added = [f for f in handler.filters if isinstance(f, RedactBrokerErrorBlob)]
            assert len(added) == 1
        finally:
            logging.getLogger().removeHandler(handler)
            mod._reset_for_tests()

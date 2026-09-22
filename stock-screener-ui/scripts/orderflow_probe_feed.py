#!/usr/bin/env python3
"""Read-only Fyers TBT probe: which MarketFeed fields are actually populated?

Subscribes ONE symbol on the TBT socket for ~30s using the recorder's token
resolution (:func:`api.orderflow_recorder.recorder_token`), parses the raw
``SocketMessage`` protobuf *before* the SDK strips it down to its ``Depth``
object, and prints per-message which sub-messages are populated (including
per-level ``num`` and ``ticksize``), plus a final summary of which fields
ever appeared.

Read-only: no journaling, no writes, no orders. Exits 0 even when the market
is closed or no data arrives.

Usage:
    python scripts/orderflow_probe_feed.py --symbol RELIANCE [--seconds 30]
"""

import argparse
import json
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_TBT_URL_FALLBACK = "wss://rtsocket-api.fyers.in/versova"

_SUB_MESSAGES = ("quote", "eq", "dq", "ohlcv", "depth", "symdetail")


def _has_field(msg, name) -> bool:
    try:
        return msg.HasField(name)
    except Exception:  # noqa: BLE001 - proto presence check is best effort
        return False


def _wrapper_present(msg, name) -> bool:
    """True when a scalar-wrapper field is set (works on real protobuf)."""
    if not _has_field(msg, name):
        return False
    try:
        return getattr(getattr(msg, name), "value", None) not in (None, "")
    except Exception:  # noqa: BLE001
        return False


def describe_feed(feed) -> dict:
    """Summarize which parts of one MarketFeed are populated (non-default)."""
    present = [name for name in _SUB_MESSAGES if _has_field(feed, name)]
    info: dict = {"sub_messages": present}
    if "quote" in present:
        info["quote_oi"] = _wrapper_present(feed.quote, "oi")
    if "eq" in present:
        info["eq_yh"] = _wrapper_present(feed.eq, "yh")
        info["eq_yl"] = _wrapper_present(feed.eq, "yl")
    if "dq" in present:
        info["dq"] = {
            key: _wrapper_present(feed.dq, key)
            for key in ("do", "dh", "dl", "dc", "dhoi", "dloi")
        }
    if "ohlcv" in present:
        info["ohlcv"] = {
            key: _wrapper_present(feed.ohlcv, key)
            for key in ("open", "high", "low", "close", "volume", "epoch")
        }
    if "depth" in present:
        depth = feed.depth
        num_levels = 0
        try:
            for side in (list(depth.asks), list(depth.bids)):
                for level in side:
                    if level.HasField("num") and level.num.value:
                        num_levels += 1
        except Exception:  # noqa: BLE001
            pass
        info["depth_tbq"] = _wrapper_present(depth, "tbq")
        info["depth_tsq"] = _wrapper_present(depth, "tsq")
        try:
            info["depth_levels"] = len(depth.asks) + len(depth.bids)
        except Exception:  # noqa: BLE001
            info["depth_levels"] = 0
        info["levels_with_num"] = num_levels
    if "symdetail" in present:
        try:
            info["ticksize"] = feed.symdetail.ticksize or ""
        except Exception:  # noqa: BLE001
            info["ticksize"] = ""
    info["sequence_no"] = getattr(feed, "sequence_no", 0) or 0
    info["snapshot"] = bool(getattr(feed, "snapshot", False))
    return info


def _format_line(info: dict) -> str:
    parts = [f"sub=[{','.join(info['sub_messages'])}]"]
    if "quote_oi" in info:
        parts.append(f"oi={info['quote_oi']}")
    if "eq_yh" in info:
        parts.append(f"yh={info['eq_yh']} yl={info['eq_yl']}")
    if "dq" in info:
        seen = [k for k, v in info["dq"].items() if v]
        parts.append(f"dq=[{','.join(seen)}]")
    if "ohlcv" in info:
        seen = [k for k, v in info["ohlcv"].items() if v]
        parts.append(f"ohlcv=[{','.join(seen)}]")
    if "depth_levels" in info:
        parts.append(
            f"levels={info['depth_levels']} num={info['levels_with_num']} "
            f"tbq={info['depth_tbq']} tsq={info['depth_tsq']}"
        )
    if "ticksize" in info:
        parts.append(f"ticksize={info['ticksize']!r}")
    parts.append(f"seq={info['sequence_no']} snap={info['snapshot']}")
    return " ".join(parts)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbol", default="RELIANCE", help="NSE symbol (default: RELIANCE)")
    parser.add_argument("--seconds", type=float, default=30.0, help="listen window (default: 30)")
    args = parser.parse_args()

    try:
        from api.orderflow_recorder import recorder_token
    except Exception as exc:  # noqa: BLE001
        print(f"probe: cannot resolve token helper: {exc}")
        print("probe: no data (token resolution unavailable).")
        return 0

    try:
        token = recorder_token("fyers_tbt")
    except Exception as exc:  # noqa: BLE001 - DB/config read is best effort
        print(f"probe: token lookup failed: {exc}")
        print("probe: no data (token unavailable; market may be closed).")
        return 0
    if not token:
        print("probe: no Fyers access token found (broker not connected?).")
        print("probe: no data (market closed or unauthenticated) — nothing to inspect.")
        return 0

    try:
        from api.orderflow_symbols import fyers_symbol
    except Exception:  # noqa: BLE001
        fyers_symbol = lambda s: s  # noqa: E731
    broker_symbol = fyers_symbol(args.symbol)

    try:
        import websocket
        from fyers_apiv3.FyersWebsocket import msg_pb2 as protomsg
    except ImportError as exc:
        print(f"probe: required dependency missing: {exc}")
        print("probe: no data (install fyers-apiv3 / websocket-client to probe).")
        return 0

    try:
        import requests

        try:
            resp = requests.get(
                "https://api-t1.fyers.in/indus/home/tbtws",
                headers={"Authorization": token},
                timeout=10,
            )
            url = resp.json()["data"]["socket_url"] if resp.status_code == 200 else _TBT_URL_FALLBACK
        except Exception:  # noqa: BLE001 - fall back to the default URL
            url = _TBT_URL_FALLBACK
    except ImportError:
        url = _TBT_URL_FALLBACK

    seen: list[dict] = []
    errors: list[str] = []
    opened = threading.Event()

    def on_message(ws, message):  # noqa: ARG001
        if isinstance(message, str):
            return  # "pong" keep-alive
        try:
            packet = protomsg.SocketMessage()
            packet.ParseFromString(message)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"parse error: {exc}")
            return
        if getattr(packet, "error", False):
            errors.append(f"server error: {getattr(packet, 'msg', '')}")
            return
        try:
            feeds = packet.feeds
        except Exception:  # noqa: BLE001
            return
        for _key, feed in feeds.items():
            info = describe_feed(feed)
            seen.append(info)
            print(f"probe: {_format_line(info)}", flush=True)

    def on_error(ws, error):  # noqa: ARG001
        errors.append(str(error))

    def on_open(ws):
        opened.set()
        ws.send(
            json.dumps(
                {
                    "type": 1,
                    "data": {
                        "subs": 1,
                        "symbols": [broker_symbol],
                        "mode": "depth",
                        "channel": "1",
                    },
                }
            )
        )
        ws.send(
            json.dumps(
                {"type": 2, "data": {"resumeChannels": ["1"], "pauseChannels": []}}
            )
        )

    print(f"probe: subscribing {broker_symbol} on Fyers TBT for {args.seconds:.0f}s ...")
    ws = websocket.WebSocketApp(
        url,
        header={"authorization": token},
        on_message=on_message,
        on_error=on_error,
        on_open=on_open,
    )
    thread = threading.Thread(target=ws.run_forever, daemon=True)
    thread.start()
    time.sleep(args.seconds)
    try:
        ws.close()
    except Exception:  # noqa: BLE001
        pass
    thread.join(timeout=5)

    if not seen:
        print("probe: no market data received.")
        if errors:
            try:
                from api.orderflow_adapters.base import strip_error_noise

                print(f"probe: errors seen: {strip_error_noise(errors[0])}")
            except Exception:  # noqa: BLE001
                print("probe: errors seen: (connection rejected)")
        print(
            "probe: this is expected when the market is closed or the token is "
            "stale — nothing to inspect."
        )
        return 0

    ever: dict[str, int] = {}
    for info in seen:
        keys = set(info["sub_messages"])
        for key in ("quote_oi", "eq_yh", "eq_yl", "depth_tbq", "depth_tsq"):
            if info.get(key):
                keys.add(key)
        for group in ("dq", "ohlcv"):
            for field, was_set in (info.get(group) or {}).items():
                if was_set:
                    keys.add(f"{group}.{field}")
        if info.get("levels_with_num"):
            keys.add("level.num")
        if info.get("ticksize"):
            keys.add("symdetail.ticksize")
        for key in keys:
            ever[key] = ever.get(key, 0) + 1

    print(f"probe: {len(seen)} feed message(s); fields ever populated:")
    for key in sorted(ever):
        print(f"probe:   {key}: {ever[key]}x")
    return 0


if __name__ == "__main__":
    sys.exit(main())

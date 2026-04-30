#!/usr/bin/env python3
"""
Benchmark Upstox Market Data: REST API (LTP V3) vs WebSocket V3 (MarketDataStreamerV3)

Usage:
    source .venv/bin/activate && python scripts/benchmark_upstox_data.py

Token sources (checked in order):
    1. DB (broker_connections table via get_shared_broker_token)
    2. .upstox_token.json file
    3. UPSTOX_ACCESS_TOKEN env var
"""

import sys
import os
import json
import time
import statistics
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
ROOT_DIR = PROJECT_DIR.parent

sys.path.insert(0, str(PROJECT_DIR))
sys.path.insert(0, str(ROOT_DIR))

try:
    from dotenv import load_dotenv
    env_file = PROJECT_DIR / ".env"
    if env_file.exists():
        load_dotenv(env_file)
except ImportError:
    pass

import requests
from importlib.metadata import version as pkg_version

KNOWN_SYMBOLS = [
    "RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK",
    "SBIN", "BHARTIARTL", "ITC", "WIPRO", "HINDUNILVR",
    "LT", "BAJFINANCE", "KOTAKBANK", "MARUTI", "TITAN",
]

INSTRUMENTS_FILE = ROOT_DIR / "upstox_trader" / "config_and_utils" / "nse_instruments.json"


def get_token() -> str:
    try:
        from db.models import get_shared_broker_token
        token_data = get_shared_broker_token("upstox")
        if token_data and token_data.get("access_token"):
            print(f"  source: DB (broker_connections)")
            return token_data["access_token"]
    except Exception:
        pass

    token_file = ROOT_DIR / ".upstox_token.json"
    if token_file.exists():
        try:
            with open(token_file) as f:
                data = json.load(f)
            if data.get("access_token"):
                print(f"  source: {token_file}")
                return data["access_token"]
        except (json.JSONDecodeError, KeyError):
            pass

    token = os.getenv("UPSTOX_ACCESS_TOKEN")
    if token:
        print(f"  source: UPSTOX_ACCESS_TOKEN env var")
        return token
    try:
        from config import UPSTOX_ACCESS_TOKEN as cfg_token
        if cfg_token:
            print(f"  source: UPSTOX_ACCESS_TOKEN env var")
            return cfg_token
    except Exception:
        pass

    raise RuntimeError(
        "No Upstox access token found.\n"
        "  Connect your broker via Settings -> Upstox, or\n"
        "  set UPSTOX_ACCESS_TOKEN env var, or\n"
        f"  create {ROOT_DIR / '.upstox_token.json'}"
    )


def load_symbols() -> list[dict]:
    if not INSTRUMENTS_FILE.exists():
        raise FileNotFoundError(f"Instruments file not found: {INSTRUMENTS_FILE}")

    with open(INSTRUMENTS_FILE) as f:
        all_instruments = json.load(f)

    symbols = {}
    for item in all_instruments:
        if item.get("segment") == "NSE_EQ" and item["trading_symbol"] in KNOWN_SYMBOLS:
            symbols[item["trading_symbol"]] = item

    result = [symbols[sym] for sym in KNOWN_SYMBOLS if sym in symbols]
    print(f"  loaded {len(result)}/{len(KNOWN_SYMBOLS)} known symbols")
    return result


def benchmark_rest(token: str, symbols: list[dict]) -> dict:
    print("\n-- REST API (LTP V3) --")

    url = "https://api.upstox.com/v3/market-quote/ltp"
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    results = {}

    for batch_size, label in [
        (1, "1 symbol"),
        (len(symbols), f"{len(symbols)} symbols"),
    ]:
        key_str = ",".join(s["instrument_key"] for s in symbols[:batch_size])
        times = []
        successes = 0
        for i in range(5):
            start = time.perf_counter()
            resp = requests.get(url, params={"instrument_key": key_str}, headers=headers)
            elapsed = time.perf_counter() - start
            if resp.status_code == 200:
                times.append(elapsed * 1000)
                successes += 1
            else:
                print(f"    attempt {i+1}: HTTP {resp.status_code} {resp.text[:80]}")

        if times:
            avg = statistics.mean(times)
            _min = min(times)
            _max = max(times)
            results[label] = {"avg": avg, "min": _min, "max": _max, "success": successes}
            print(f"  {label:>12s}: avg={avg:8.2f}ms  min={_min:8.2f}ms  max={_max:8.2f}ms  ({successes}/5 ok)")
        else:
            results[label] = {"avg": None, "min": None, "max": None, "success": 0}
            print(f"  {label:>12s}: FAILED (all requests errored)")

    return results


def benchmark_ws(token: str, symbols: list[dict]) -> dict | None:
    print("\n-- WebSocket V3 (MarketDataStreamerV3, mode=ltpc) --")

    import upstox_client
    from upstox_client import MarketDataStreamerV3

    config = upstox_client.Configuration()
    config.access_token = token
    client = upstox_client.ApiClient(config)

    keys = [s["instrument_key"] for s in symbols]
    received_ticks: list[dict] = []
    start_time: float | None = None
    first_tick_time: float | None = None
    error_msg: str | None = None

    def on_message(data):
        nonlocal first_tick_time
        now = time.perf_counter()
        received_ticks.append({"ts": now, "data": data})
        if first_tick_time is None and start_time is not None:
            first_tick_time = now - start_time

    streamer = MarketDataStreamerV3(client, [], mode="ltpc")
    streamer.on("message", on_message)

    def on_open():
        nonlocal start_time
        print("  connected, subscribing...")
        streamer.subscribe(keys, "ltpc")
        start_time = time.perf_counter()

    def on_error(err):
        nonlocal error_msg
        error_msg = str(err)
        print(f"    WS error: {err}")

    streamer.on("open", on_open)
    streamer.on("error", on_error)

    print("  connecting...")
    connect_start = time.perf_counter()
    streamer.connect()
    connect_elapsed = time.perf_counter() - connect_start
    print(f"  connect() returned in {connect_elapsed*1000:.1f}ms")

    duration = 15
    print(f"  collecting data for {duration}s...")
    time.sleep(duration)

    streamer.disconnect()
    time.sleep(0.5)

    if error_msg:
        print(f"  errors: {error_msg}")

    if not received_ticks:
        print("  NO ticks received")
        return None

    live_feed = [t for t in received_ticks if isinstance(t["data"], dict) and t["data"].get("type") == "live_feed"]
    market_info = [t for t in received_ticks if isinstance(t["data"], dict) and t["data"].get("type") == "market_info"]

    print(f"  total messages: {len(received_ticks)}")
    print(f"    live_feed:    {len(live_feed)}")
    print(f"    market_info:  {len(market_info)}")

    if first_tick_time is not None:
        print(f"  time to first tick: {first_tick_time*1000:.1f}ms")

    if len(live_feed) >= 2:
        intervals = [(live_feed[i]["ts"] - live_feed[i - 1]["ts"]) * 1000 for i in range(1, len(live_feed))]
        avg_int = statistics.mean(intervals)
        min_int = min(intervals)
        max_int = max(intervals)
        tps = len(live_feed) / duration
        print(f"  ticks/sec:  {tps:.1f}")
        print(f"  avg interval: {avg_int:.1f}ms")
        print(f"  min interval: {min_int:.1f}ms")
        print(f"  max interval: {max_int:.1f}ms")
    elif len(live_feed) == 1:
        print("  only 1 live_feed tick (market may be closed)")

    return {
        "total_ticks": len(received_ticks),
        "live_feed": len(live_feed),
        "first_tick_ms": first_tick_time * 1000 if first_tick_time is not None else None,
        "ticks_per_sec": len(live_feed) / duration if live_feed else 0,
    }


def main():
    print("=== UPSTOX MARKET DATA BENCHMARK ===")
    try:
        sdk_ver = pkg_version("upstox-python-sdk")
    except Exception:
        sdk_ver = "unknown"
    print(f"  SDK: upstox-python-sdk {sdk_ver}")
    print(f"  requests: {requests.__version__}")

    print("\n-- Token --")
    try:
        token = get_token()
        print(f"  length: {len(token)} chars")
    except RuntimeError as e:
        print(f"  {e}")
        sys.exit(1)

    print("\n-- Symbols --")
    try:
        symbols = load_symbols()
    except FileNotFoundError as e:
        print(f"  {e}")
        sys.exit(1)

    rest_results = benchmark_rest(token, symbols)

    ws_results = benchmark_ws(token, symbols)

    print("\n=== COMPARISON ===")
    if rest_results:
        r1 = rest_results.get("1 symbol", {})
        r15 = rest_results.get(f"{len(symbols)} symbols", {})
        if r1.get("avg"):
            print(f"  REST  1 symbol:    {r1['avg']:>8.2f}ms avg  ({r1['success']}/5 ok)")
        if r15.get("avg"):
            print(f"  REST  {len(symbols)} symbols:  {r15['avg']:>8.2f}ms avg  ({r15['success']}/5 ok)")

    if ws_results:
        ft = ws_results["first_tick_ms"]
        print(f"  WS    first tick:  {ft:>8.1f}ms" if ft is not None else "  WS    first tick:  N/A")
        print(f"  WS    ticks/sec:   {ws_results['ticks_per_sec']:>8.1f}")

    print()


if __name__ == "__main__":
    main()

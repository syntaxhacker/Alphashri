# FYERS API Reference

Compact, source-backed notes for the FYERS v3 Python integration. Written against
`fyers-apiv3==3.1.17` (installed under
`stock-screener-ui/.venv/lib/python3.12/site-packages/fyers_apiv3/`) on
2026-09-24. Treat wire limits and field presence as version-sensitive.

## Start here

- [Authentication](fyers_auth.md) — OAuth, separate-vs-combined token inputs,
  REST headers, expiry and refresh.
- [WebSockets](fyers_websockets.md) — data, TBT/protobuf and order sockets;
  exact subscription payloads; `MarketFeed` map.
- [REST market data](fyers_market_data.md) — quotes, depth, history and
  options-chain-v3.
- [Gotchas](fyers_gotchas.md) — SDK mutations, singleton state, feed gaps and
  handshake redaction. Read this before debugging a feed.

## Primary sources

- [Official Fyers skill: WebSocket feeds](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/websocket.md)
- [Official Fyers skill: market data](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/market-data.md)
- [Official Fyers skill: authentication](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/auth.md)
- [TBT protobuf schema](https://public.fyers.in/tbtproto/1.0.0/msg.proto)
- [Fyers data WebSocket support](https://support.fyers.in/portal/en/kb/fyers-api-integrations/fyers-api/api-v3/data-websocket)
- [Market Depth support](https://support.fyers.in/portal/en/kb/articles/how-do-i-use-the-market-depth-api-to-get-market-depth-data-for-a-specific-symbol)
- [TBT individual-trade feature request](https://fyers.in/community/feedback-feature-requests-it03436p/post/feature-request-add-individual-trade-data-stream-to-fyers-tbt-websocket-mx1bPibC03GCmTk)

## Evidence labels

- **SDK-verified**: observed in the installed source or runtime descriptor.
- **Docs-verified**: stated by the official Fyers reference/support page.
- **Live/local evidence**: recorded in this repository's probe, journal or
  order-flow documentation; values may be session-specific.
- **UNCERTAIN**: sources conflict or the installed SDK does not expose the
  documented API. Do not silently promote an uncertain item to a hard limit.

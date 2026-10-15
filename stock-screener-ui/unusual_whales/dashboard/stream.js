/* Live push stream client (SSE) for the Unusual Whales dashboard.
 *
 * Server contract (fixed — do not change):
 *   GET /api/stream/alerts  -> text/event-stream
 *       status   {"phase":"open|premarket|afterhours|closed","connected":true}
 *       snapshot {"ids":["..."]}                       // ids at connect (seed, NOT new)
 *       live     {"ts","phase","new":[{...}]}
 *       oi       {"new":[{...}]}
 *       : ping                                         // comment heartbeat
 *   GET /api/stream/quote?tickers=A,B -> quote {"ticker","last","prev_close","chg_pct","market_time","ts"}
 *
 * Public API (window.UW.stream):
 *   start()             open the alerts stream (idempotent, never throws)
 *   on(evt, fn)         subscribe: "status" | "snapshot" | "live" | "oi"
 *   off(evt, fn)        unsubscribe
 *   state()             {connected, phase, reconnects, fallback}
 *   quote(tickers, cb)  separate quote stream -> returns stop()
 *
 * Fallback: EventSource auto-reconnects. If it is unavailable, or errors 3x
 * within 30s, `state().fallback` becomes true and callers keep their existing
 * polling — this module NEVER starts its own polling loop.
 */
(function () {
  const U = (window.UW = window.UW || {});
  const EVENTS = ["status", "snapshot", "live", "oi"];

  const listeners = { status: [], snapshot: [], live: [], oi: [] };
  const seed = new Set(); // ids present at connect — NOT "new"
  const _st = { connected: false, phase: "", reconnects: 0, fallback: false, started: false };

  let _es = null;
  let _errTimes = [];

  function fire(evt, payload) {
    const arr = listeners[evt];
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) {
      try {
        arr[i](payload);
      } catch (e) {
        /* a bad listener must never break the stream */
      }
    }
  }

  function parse(ev) {
    try {
      return ev && ev.data ? JSON.parse(ev.data) : null;
    } catch (e) {
      return null;
    }
  }

  function statusPayload() {
    return { phase: _st.phase, connected: _st.connected, fallback: _st.fallback };
  }

  function onStatus(ev) {
    const d = parse(ev) || {};
    if (d.phase != null) _st.phase = String(d.phase);
    if (d.connected != null) _st.connected = !!d.connected;
    fire("status", statusPayload());
  }

  function onSnapshot(ev) {
    const d = parse(ev) || {};
    (d.ids || []).forEach((id) => {
      if (id) seed.add(String(id));
    });
    fire("snapshot", d);
  }

  function onLive(ev) {
    const d = parse(ev);
    if (d) fire("live", d);
  }

  function onOi(ev) {
    const d = parse(ev);
    if (d) fire("oi", d);
  }

  function onOpen() {
    _st.connected = true;
    _st.fallback = false;
    _errTimes = [];
    fire("status", statusPayload());
  }

  function onError() {
    // EventSource keeps auto-reconnecting on transient errors; just record it.
    _st.connected = false;
    _st.reconnects += 1;
    const now = Date.now();
    _errTimes.push(now);
    _errTimes = _errTimes.filter((t) => now - t < 30000);
    if (_errTimes.length >= 3) _st.fallback = true;
    fire("status", statusPayload());
  }

  function start() {
    if (_st.started) return _st;
    _st.started = true;
    if (typeof window.EventSource !== "function") {
      _st.fallback = true;
      fire("status", statusPayload());
      return _st;
    }
    try {
      const es = new EventSource("/api/stream/alerts");
      _es = es;
      es.addEventListener("open", onOpen);
      es.addEventListener("status", onStatus);
      es.addEventListener("snapshot", onSnapshot);
      es.addEventListener("live", onLive);
      es.addEventListener("oi", onOi);
      es.addEventListener("error", onError);
    } catch (e) {
      _st.fallback = true;
      fire("status", statusPayload());
    }
    return _st;
  }

  function quote(tickers, cb) {
    const list = [...new Set((tickers || []).map((t) => String(t == null ? "" : t).trim().toUpperCase()).filter(Boolean))].slice(0, 20);
    if (!list.length || typeof window.EventSource !== "function") return function () {};
    let es;
    try {
      es = new EventSource("/api/stream/quote?tickers=" + encodeURIComponent(list.join(",")));
    } catch (e) {
      return function () {};
    }
    const onQuote = (ev) => {
      const d = parse(ev);
      if (d && typeof cb === "function") {
        try {
          cb(d);
        } catch (e) {
          /* listener error is isolated */
        }
      }
    };
    const onQuoteError = () => {
      /* browser auto-reconnects; nothing to do here */
    };
    es.addEventListener("quote", onQuote);
    es.addEventListener("error", onQuoteError);
    return function stop() {
      try {
        es.removeEventListener("quote", onQuote);
        es.removeEventListener("error", onQuoteError);
        es.close();
      } catch (e) {
        /* ignore */
      }
    };
  }

  U.stream = {
    start,
    on(evt, fn) {
      if (!listeners[evt] || typeof fn !== "function") return;
      if (listeners[evt].indexOf(fn) < 0) listeners[evt].push(fn);
    },
    off(evt, fn) {
      const arr = listeners[evt];
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    state() {
      return { connected: _st.connected, phase: _st.phase, reconnects: _st.reconnects, fallback: _st.fallback };
    },
    // ids seen in the connect-time snapshot — use to tell "genuinely new" rows
    isSeed(id) {
      return seed.has(String(id));
    },
    seedSet() {
      return seed;
    },
    quote,
  };

  // only the listed event names are subscribable; expose for tests/debug
  U.stream._events = EVENTS.slice();
})();

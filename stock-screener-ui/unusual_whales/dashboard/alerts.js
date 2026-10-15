/* OI-change alerts — the dedicated notification section. Reachable at #/alerts.
 *
 * Data: /api/alerts (scripts/alerts_data.py) — market-wide fresh open-interest
 * builds from /api/market/oi-change, ranked by severity. A tiny watcher
 * (UW.startAlerts) polls in the background and drives the header bell badge;
 * an opt-in toggle fires desktop notifications + a beep for new high/critical
 * alerts. "Seen" ids are stored in localStorage so NEW alerts are highlighted
 * until you look at them.
 */
(function () {
  const U = (window.UW = window.UW || {});
  const { esc, money, num, int, signCls, tk } = U.util;

  const SEV = ["critical", "high", "watch"];
  const SEV_LABEL = { critical: "CRITICAL", high: "HIGH", watch: "WATCH" };
  const KEY_SEEN = "uw_alerts_seen";
  const KEY_LIVE_SEEN = "uw_live_seen";
  const KEY_LIVE_MIN = "uw_live_min";
  const KEY_NOTIFY = "uw_alerts_notify";
  const KEY_SOUND = "uw_alerts_sound";
  const KEY_TELEGRAM = "uw_alerts_telegram";
  const KEY_MUTE = "uw_alerts_mute";
  const KEY_VIEW = "uw_alert_view"; // "cluster" (default) | "raw"
  const MUTE_DEFAULT = ["SPX", "QQQ"];

  const A = (U.ALERTS = {
    seen() {
      try {
        const a = JSON.parse(localStorage.getItem(KEY_SEEN) || "[]");
        return Array.isArray(a) ? a : [];
      } catch (e) {
        return [];
      }
    },
    markSeen(ids) {
      const s = new Set(A.seen());
      (ids || []).forEach((i) => i && s.add(i));
      try {
        localStorage.setItem(KEY_SEEN, JSON.stringify([...s].slice(-800)));
      } catch (e) {
        /* ignore */
      }
    },
    liveSeen() {
      try {
        const a = JSON.parse(localStorage.getItem(KEY_LIVE_SEEN) || "[]");
        return Array.isArray(a) ? a : [];
      } catch (e) {
        return [];
      }
    },
    markLiveSeen(ids) {
      const s = new Set(A.liveSeen());
      (ids || []).forEach((i) => i && s.add(i));
      try {
        localStorage.setItem(KEY_LIVE_SEEN, JSON.stringify([...s].slice(-1200)));
      } catch (e) {
        /* ignore */
      }
    },
    liveMin() {
      const n = Number(localStorage.getItem(KEY_LIVE_MIN));
      return [250000, 500000, 1000000].indexOf(n) >= 0 ? n : 250000;
    },
    setLiveMin(n) {
      try {
        localStorage.setItem(KEY_LIVE_MIN, String(n));
      } catch (e) {
        /* ignore */
      }
    },
    // live-table view: "cluster" (one row per ticker, default) | "raw" (every print)
    alertView() {
      try {
        return localStorage.getItem(KEY_VIEW) === "raw" ? "raw" : "cluster";
      } catch (e) {
        return "cluster";
      }
    },
    setAlertView(v) {
      try {
        localStorage.setItem(KEY_VIEW, v === "raw" ? "raw" : "cluster");
      } catch (e) {
        /* ignore */
      }
    },
    notifyOn: () => localStorage.getItem(KEY_NOTIFY) === "1",
    soundOn: () => localStorage.getItem(KEY_SOUND) === "1",
    telegramOn: () => localStorage.getItem(KEY_TELEGRAM) === "1",
    muted() {
      try {
        const raw = localStorage.getItem(KEY_MUTE);
        if (raw === null) return MUTE_DEFAULT.slice();
        const a = JSON.parse(raw);
        return Array.isArray(a) ? a.map((x) => String(x).toUpperCase()) : MUTE_DEFAULT.slice();
      } catch (e) {
        return MUTE_DEFAULT.slice();
      }
    },
    setMuted(list) {
      try {
        localStorage.setItem(KEY_MUTE, JSON.stringify([...new Set((list || []).map((x) => String(x).toUpperCase()))]));
      } catch (e) {
        /* ignore */
      }
    },
    addMuted(t) {
      const T = String(t || "").trim().toUpperCase();
      if (!T) return;
      const l = A.muted();
      if (l.indexOf(T) < 0) l.push(T);
      A.setMuted(l);
    },
    removeMuted(t) {
      const T = String(t || "").toUpperCase();
      A.setMuted(A.muted().filter((x) => x !== T));
    },
    // exact match, or a prefix for index families (muting SPX also mutes SPXW)
    isMuted(t) {
      const T = String(t || "").toUpperCase();
      if (!T) return false;
      return A.muted().some((m) => m === T || (m.length >= 3 && T.startsWith(m)));
    },
    set(key, val) {
      try {
        localStorage.setItem(key, val ? "1" : "0");
      } catch (e) {
        /* ignore */
      }
    },
  });

  // live flow severity: sweeps + size get promoted
  function liveSeverity(a) {
    const p = Number(a.premium) || 0;
    if (a.sweep && p >= 500000) return "critical";
    if (p >= 1000000) return "critical";
    if (a.sweep || p >= 500000) return "high";
    return "watch";
  }
  const KIND_LABEL = { flow: "FLOW", unusual: "UNUSUAL", darkpool: "DARK", oi: "OI" };

  let _audio = null;
  function audioCtx() {
    try {
      if (!_audio) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        _audio = new Ctx();
      }
      if (_audio.state === "suspended") _audio.resume().catch(() => {});
      return _audio;
    } catch (e) {
      return null;
    }
  }
  // any user gesture unlocks audio (browsers block autoplay until then)
  ["click", "keydown", "touchstart"].forEach((ev) =>
    document.addEventListener(ev, () => audioCtx(), { capture: true, passive: true })
  );

  function beep() {
    try {
      const ctx = audioCtx();
      // browsers block audio until the first user gesture — stay silent instead of throwing
      if (!ctx || ctx.state !== "running") return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.06;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(() => {
        try {
          osc.stop();
        } catch (e) {
          /* ignore */
        }
      }, 170);
      U._soundLast = Date.now();
    } catch (e) {
      /* ignore */
    }
  }

  // explicit test so the user can verify notification + sound on demand
  U.testAlert = function () {
    try {
      new Notification("UW test — desktop alert", { body: "If you see this and hear a beep, alerts work.", tag: "uw-test" });
      U._notifyLast = Date.now();
    } catch (e) {
      /* notifications unavailable */
    }
    beep();
  };

  const sevPill = (s) => `<span class="pill sev-${esc(s)}">${SEV_LABEL[s] || esc(s)}</span>`;
  const typeCls = (t) => (t === "call" ? "pos" : t === "put" ? "neg" : "muted");
  const ago = (iso) => {
    if (!iso) return "";
    const t = Date.parse(iso);
    if (isNaN(t)) return "";
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return Math.round(s) + "s";
    if (s < 3600) return Math.round(s / 60) + "m";
    return Math.round(s / 3600) + "h";
  };

  U.updateAlertBadge = function (n) {
    const el = document.getElementById("alerts-count");
    const v = Math.max(0, Number(n) || 0);
    U._alertBadgeN = v;
    if (!el) return;
    el.textContent = v > 99 ? "99+" : String(v);
    el.hidden = v <= 0;
    // the badge counts NON-muted unread alerts only; spell that out so it never
    // looks like "0 unread" while muted tickers are quietly piling up
    const m = A.muted();
    el.title =
      v > 0
        ? v + " unread alert" + (v === 1 ? "" : "s") + (m.length ? " · muted tickers excluded: " + m.join(", ") : "")
        : m.length
        ? "No unread alerts · muted tickers excluded: " + m.join(", ")
        : "No unread alerts";
  };

  async function postTelegram(a) {
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alert: a }),
      });
      const j = await res.json().catch(() => ({}));
      if (j && j.ok) U._tgLast = Date.now();
    } catch (e) {
      /* offline */
    }
  }

  // schedule the Alerts view auto-refresh (live cadence, visibility-gated)
  function armView(root) {
    if (U._alertsTimer) clearInterval(U._alertsTimer);
    const tickView = () => {
      if (location.hash.startsWith("#/alerts")) U.renderAlerts(root);
      else {
        clearInterval(U._alertsTimer);
        U._alertsTimer = null;
      }
    };
    U._alertsTimer = U.every ? U.every("live", tickView) : setInterval(tickView, 20000);
  }

  // ---- live push stream (SSE) --------------------------------------------
  // The server pushes genuinely-new alerts; bump the bell and repaint the
  // mounted Alerts view immediately (existing row flash) instead of waiting
  // for the poll. Polling stays on as the fallback + count reconciler.
  let _streamRenderTimer = null;
  function scheduleStreamRender() {
    if (_streamRenderTimer) return;
    _streamRenderTimer = setTimeout(() => {
      _streamRenderTimer = null;
      if (!location.hash.startsWith("#/alerts")) return;
      const root = document.getElementById("view");
      if (root && root.querySelector("[data-alerts-view]")) U.renderAlerts(root);
    }, 500);
  }

  function onStreamEvent(kind, d) {
    const items = (d && d.new) || [];
    if (!items.length) return;
    const S = U.stream;
    const seenO = new Set(A.seen().map(String));
    const seenL = new Set(A.liveSeen().map(String));
    const counted = (U._streamCounted = U._streamCounted || new Set());
    const min = A.liveMin();
    let delta = 0;
    items.forEach((a) => {
      if (!a || a.id == null) return;
      const id = String(a.id);
      if (counted.has(id)) return;
      counted.add(id);
      if (S && S.isSeed && S.isSeed(id)) return; // present at connect — not new
      if (A.isMuted(a.ticker)) return;
      if (kind === "oi") {
        if (a.severity !== "watch" && !seenO.has(id)) delta += 1;
      } else if ((Number(a.premium) || 0) >= min && !seenL.has(id)) {
        delta += 1;
      }
    });
    if (delta) U.updateAlertBadge((U._alertBadgeN || 0) + delta);
    if (location.hash.startsWith("#/alerts")) scheduleStreamRender();
  }

  let _streamWired = false;
  function wireStream() {
    if (_streamWired) return;
    const S = U.stream;
    if (!S || typeof S.start !== "function" || typeof S.on !== "function") return;
    _streamWired = true;
    S.on("live", (d) => onStreamEvent("live", d));
    S.on("oi", (d) => onStreamEvent("oi", d));
    try {
      S.start();
    } catch (e) {
      /* fall back to polling */
    }
  }

  // background watcher — badge + optional desktop notification.
  // Polls even on a hidden tab (slower cadence) so it can still ring while you
  // are elsewhere; skips nothing except network errors.
  U.startAlerts = function () {
    wireStream();
    if (U._alertTimer) return;
    // track which alerts we have already toasted so we never re-fire the same one
    const notified = (U._notified = U._notified || new Set());
    const tgNotified = (U._tgNotified = U._tgNotified || new Set());
    let seeded = false;
    async function tick() {
      try {
        const [ra, rl] = await Promise.all([fetch("/api/alerts"), fetch("/api/live")]);
        const [dA, dL] = await Promise.all([ra.ok ? ra.json() : { alerts: [] }, rl.ok ? rl.json() : { alerts: [] }]);
        const seenO = new Set(A.seen());
        const seenL = new Set(A.liveSeen());
        // First tick on a fresh browser: seed the seen-stores so we don't blast a
        // notification for every print that already existed before you arrived.
        if (!seeded) {
          seeded = true;
          if (!seenL.size) {
            A.markLiveSeen((dL.alerts || []).map((a) => a.id));
            (dL.alerts || []).forEach((a) => seenL.add(a.id));
          }
          if (!seenO.size) {
            A.markSeen((dA.alerts || []).map((a) => a.id));
            (dA.alerts || []).forEach((a) => seenO.add(a.id));
          }
        }
        const min = A.liveMin();
        const freshO = (dA.alerts || []).filter((a) => !seenO.has(a.id) && !A.isMuted(a.ticker));
        const freshL = (dL.alerts || []).filter((a) => !seenL.has(a.id) && (Number(a.premium) || 0) >= min && !A.isMuted(a.ticker));
        const unread = freshO.filter((a) => a.severity !== "watch").length + freshL.length;
        U.updateAlertBadge(unread);
        if (A.notifyOn() && (freshO.length || freshL.length)) {
          const loudO = freshO.filter((a) => (a.severity === "critical" || a.severity === "high") && !notified.has(a.id));
          // any new live print at/above the threshold notifies; sweeps get promoted
          const loudL = freshL.filter((a) => !notified.has(a.id));
          loudL.slice(0, 3).forEach((a) => {
            notified.add(a.id);
            try {
              new Notification(`⚡ ${a.ticker} ${String(a.type || a.kind).toUpperCase()} ${money(a.premium)}${a.sweep ? " · SWEEP" : ""}`, {
                body: `${KIND_LABEL[a.kind] || a.kind}${a.rule ? " · " + a.rule : ""}${a.strike ? " · " + a.strike + (a.expiry ? " " + String(a.expiry).slice(5) : "") : ""}${a.side ? " · " + a.side : ""}`,
                tag: a.id,
              });
            } catch (e) {
              /* notifications unavailable */
            }
          });
          loudO.slice(0, 3).forEach((a) => {
            notified.add(a.id);
            try {
              new Notification(`OI alert · ${a.ticker} ${SEV_LABEL[a.severity]}`, {
                body: `${String(a.type).toUpperCase()} ${a.strike} exp ${a.expiry} — OI ×${a.oi_ratio} (+${int(a.oi_delta)}), vol ${int(a.volume)} (${a.vol_oi}x OI)`,
                tag: a.id,
              });
            } catch (e) {
              /* notifications unavailable */
            }
          });
          if ((loudL.length || loudO.length) && A.soundOn()) beep();
          if (loudL.length || loudO.length) U._notifyLast = Date.now();
        }
        // optional Telegram mirror (independent of desktop notifications)
        if (A.telegramOn() && (freshO.length || freshL.length)) {
          freshL
            .filter((a) => !tgNotified.has(a.id))
            .slice(0, 3)
            .forEach((a) => {
              tgNotified.add(a.id);
              postTelegram(a);
            });
          freshO
            .filter((a) => (a.severity === "critical" || a.severity === "high") && !tgNotified.has(a.id))
            .slice(0, 3)
            .forEach((a) => {
              tgNotified.add(a.id);
              postTelegram({ kind: "oi", ticker: a.ticker, type: a.type, strike: a.strike, expiry: a.expiry, premium: a.notional, rule: "OI " + a.severity, side: "" });
            });
        }
        U._lastAlerts = dA;
        U._lastLive = dL;
      } catch (e) {
        /* offline — retry next tick */
      }
    }
    async function loop() {
      await tick();
      const hidden = U.isVisible ? !U.isVisible() : document.visibilityState !== "visible";
      const ms = hidden
        ? (U.pollHidden ? U.pollHidden("live") : 120000)
        : (U.pollMs ? U.pollMs("live") : 20000);
      U._alertTimer = setTimeout(loop, ms);
    }
    loop();
  };

  // compact strip for the home snapshot
  U.renderAlertStrip = function (el, d) {
    if (!el) return;
    const alerts = (d && d.alerts) || [];
    const seen = new Set(A.seen());
    const top = alerts.filter((a) => !A.isMuted(a.ticker)).slice(0, 6);
    if (!top.length) {
      el.innerHTML = '<div class="muted" style="padding:6px">no fresh OI builds</div>';
      return;
    }
    el.innerHTML = `<table><thead><tr><th>Sev</th><th>Tkr</th><th>Type</th><th>Strike</th><th class="num">OI ×</th><th class="num">+OI</th></tr></thead><tbody>${top
      .map(
        (a) =>
          `<tr><td>${sevPill(a.severity)}</td><td>${tk(a.ticker)}</td><td class="${typeCls(a.type)}">${String(a.type).toUpperCase()}</td><td class="num">${esc(a.strike)}</td><td class="num">${num(a.oi_ratio, 2)}</td><td class="num ${signCls(a.oi_delta)}">${int(a.oi_delta)}</td></tr>`
      )
      .join("")}</tbody></table><div class="wl-note">${
      d && d.session ? "<b>" + esc(d.session) + "</b> · " : ""
    }most recent completed options session · <b>${alerts.length}</b> alerts · open the <b>Alerts</b> tab for all</div>`;
  };

  // compact live-flow strip for the home snapshot
  U.renderLiveStrip = function (el, d) {
    if (!el) return;
    const alerts = ((d && d.alerts) || [])
      .filter((a) => !A.isMuted(a.ticker))
      .slice()
      .sort((a, b) => (Number(b.premium) || 0) - (Number(a.premium) || 0))
      .slice(0, 6);
    if (!alerts.length) {
      el.innerHTML = '<div class="muted" style="padding:6px">no live prints ≥ threshold (real-time feeds are quiet premarket / after close)</div>';
      return;
    }
    el.innerHTML = `<table><thead><tr><th>Kind</th><th>Tkr</th><th>Type</th><th class="num">Prem</th><th>⚡</th></tr></thead><tbody>${alerts
      .map(
        (a) =>
          `<tr><td class="muted">${esc(KIND_LABEL[a.kind] || a.kind)}</td><td>${tk(a.ticker)}</td><td class="${typeCls(a.type)}">${esc(String(a.type || "–").toUpperCase())}</td><td class="num" style="background:${U.heat(Number(a.premium) || 0, 5000000)}">${money(a.premium)}</td><td class="${a.sweep ? "warn" : "muted"}">${a.sweep ? "⚡" : ""}</td></tr>`
      )
      .join("")}</tbody></table><div class="wl-note">live tape (flow · unusual · dark pool) ≥ <b>${money((d && d.min_premium) || 250000)}</b> · updated ${esc(ago(d && d.generated_at))} ago · open <b>Alerts</b> for all</div>`;
  };

  // kept at module scope so auto-refresh doesn't reset the user's filters
  let sev = "all";
  let onlyNew = false;
  let onlyWatch = false;
  let liveKind = "all";
  let liveOnlyWatch = false;
  let liveMin = 250000;
  let alertView = "cluster";
  let hideMuted = false;
  // ids rendered in the previous paint — the flash only fires for genuinely new rows
  let oiRendered = null;
  let liveRendered = null;

  // ---- inline filters (shared by both alert tables) -----------------------
  const CLASSES = ["stock", "etf", "index", "other"];
  const CLASS_LABEL = { stock: "Stocks", etf: "ETFs", index: "Indexes", other: "Other" };
  let fClasses = (function () {
    try {
      const a = JSON.parse(localStorage.getItem("uw_alert_classes") || "null");
      if (Array.isArray(a) && a.length) return new Set(a.filter((x) => CLASSES.indexOf(x) >= 0));
    } catch (e) {
      /* ignore */
    }
    return new Set(CLASSES);
  })();
  let fType = "all"; // all | call | put
  let fExpiry = "all"; // all | today | week
  let fSweep = false;
  let filtersOpen = localStorage.getItem("uw_alert_filters") !== "0";
  // time range for the alerts table: short live windows, the live feed, or persisted sqlite history
  const LIVE_WINDOWS = { "5m": 5, "10m": 10, "30m": 30 };
  const LIVE_RANGES = ["live", "5m", "10m", "30m"];
  let liveRange = (function () {
    const r = localStorage.getItem("uw_alert_range");
    return ["live", "5m", "10m", "30m", "1h", "today", "all"].indexOf(r) >= 0 ? r : "live";
  })();
  const RANGES = [
    { id: "live", label: "Live" },
    { id: "5m", label: "5m" },
    { id: "10m", label: "10m" },
    { id: "30m", label: "30m" },
    { id: "1h", label: "1h" },
    { id: "today", label: "Today" },
    { id: "all", label: "All" },
  ];
  const isLiveRange = () => LIVE_RANGES.indexOf(liveRange) >= 0;
  function rangeSince() {
    if (liveRange === "1h") return new Date(Date.now() - 3600000).toISOString();
    if (liveRange === "today") return todayET();
    return "";
  }
  // keep only rows whose event time is inside the selected live window
  function withinWindow(rows) {
    const mins = LIVE_WINDOWS[liveRange];
    if (!mins) return rows;
    const cut = Date.now() - mins * 60000;
    return rows.filter((a) => {
      const t = Date.parse(a.created_at || a.session || "");
      return !isNaN(t) && t >= cut;
    });
  }

  const todayET = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  function expiryBucket(exp) {
    const e = String(exp || "").slice(0, 10);
    if (!e) return "none";
    const t = todayET();
    if (e === t) return "today";
    const d = new Date();
    d.setDate(d.getDate() + 7);
    const wk = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    return e > t && e <= wk ? "week" : "later";
  }
  function passCommon(row) {
    if (!fClasses.has(row.asset_class || "stock")) return false;
    if (fType !== "all" && String(row.type || "").toLowerCase() !== fType) return false;
    if (fExpiry !== "all") {
      const b = expiryBucket(row.expiry);
      if (fExpiry === "today" && b !== "today") return false;
      if (fExpiry === "week" && b !== "today" && b !== "week") return false;
    }
    return true;
  }
  function setClasses(s) {
    fClasses = s;
    try {
      localStorage.setItem("uw_alert_classes", JSON.stringify([...s]));
    } catch (e) {
      /* ignore */
    }
  }

  // ---- cluster mode ------------------------------------------------------
  // One row per ticker, built from the already-filtered live rows. Pure and
  // dependency-free so it can be exercised without a DOM (U.clusterAlerts).
  function alertDte(exp) {
    const m = String(exp || "").slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const t = todayET().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!t) return null;
    const days = (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(+t[1], +t[2] - 1, +t[3])) / 86400000;
    return Math.round(days);
  }
  function clusterAlerts(rows) {
    const map = new Map();
    (rows || []).forEach((a) => {
      const t = String((a && a.ticker) || "").toUpperCase();
      if (!t) return;
      let g = map.get(t);
      if (!g) {
        g = { ticker: t, call: 0, put: 0, other: 0, count: 0, sweeps: 0, last: "", exp: "", prints: [] };
        map.set(t, g);
      }
      const prem = Number(a.premium) || 0;
      const typ = String(a.type || "").toLowerCase();
      if (typ === "call") g.call += prem;
      else if (typ === "put") g.put += prem;
      else g.other += 1; // darkpool / untyped — never pollutes net
      g.count += 1;
      if (a.sweep) g.sweeps += 1;
      if (a.created_at && (!g.last || a.created_at > g.last)) g.last = a.created_at;
      if (a.expiry) {
        const e = String(a.expiry).slice(0, 10);
        if (e && (!g.exp || e < g.exp)) g.exp = e;
      }
      g.prints.push({ strike: a.strike, expiry: a.expiry, premium: prem, type: typ });
    });
    const out = [];
    map.forEach((g) => {
      g.net = g.call - g.put;
      g.total = g.call + g.put;
      const band = 0.15 * g.total;
      g.bias = g.net > band ? "bull" : g.net < -band ? "bear" : "mix";
      g.dte = g.exp ? alertDte(g.exp) : null;
      g.prints.sort((a, b) => b.premium - a.premium);
      // top-3 *option* prints for the row tooltip (strike/exp/prem); darkpool
      // prints have no strike, they are surfaced via the "N dark" count
      g.top = g.prints.filter((p) => p.type === "call" || p.type === "put").slice(0, 3);
      out.push(g);
    });
    out.sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || b.count - a.count || (a.ticker < b.ticker ? -1 : 1));
    return out;
  }
  U.clusterAlerts = clusterAlerts;
  U.alertDte = alertDte;

  // sticky first column for the live tables (header sticky already comes from
  // the global stylesheet; the first column needs its own rule + opaque bg)
  function ensureAvStyle() {
    if (typeof document === "undefined" || document.getElementById("av-style")) return;
    const st = document.createElement("style");
    st.id = "av-style";
    st.textContent =
      "[data-alerts-view] table.av-table thead th:first-child{position:sticky;left:0;z-index:3;background:#0e1620}" +
      "[data-alerts-view] table.av-table tbody td:first-child{position:sticky;left:0;z-index:2;background:#101720}" +
      "[data-alerts-view] table.av-table tbody tr:nth-child(even) td:first-child{background:#121b25}" +
      "[data-alerts-view] table.av-table tbody tr:hover td:first-child{background:#16202f}";
    document.head.appendChild(st);
  }

  // ---- empty states: name the active filter + how to widen ----------------
  function activeLiveFilters() {
    const h = [];
    if (fType !== "all") h.push(fType === "call" ? "Calls only" : "Puts only");
    if (fExpiry === "today") h.push("exp today");
    else if (fExpiry === "week") h.push("exp ≤7d");
    if (fSweep) h.push("sweeps only");
    if (liveKind !== "all") h.push((KIND_LABEL[liveKind] || liveKind) + " only");
    if (fClasses.size < CLASSES.length) h.push([...fClasses].map((c) => CLASS_LABEL[c] || c).join("/"));
    if (liveOnlyWatch) h.push("★ watchlist only");
    if (hideMuted) h.push("hiding muted");
    return h;
  }
  function liveEmptyMsg() {
    const win = liveRange === "live" ? "the live feed" : LIVE_WINDOWS[liveRange] ? "last " + liveRange : liveRange + " history";
    const minTxt = isLiveRange() ? " at ≥ " + money(liveMin) : "";
    const act = activeLiveFilters();
    let sug = "";
    if (isLiveRange()) {
      if (liveMin > 250000 || (LIVE_WINDOWS[liveRange] && liveRange !== "30m")) sug = " — try 30m or a lower min";
      else if (liveRange === "live") sug = " (real-time feeds are quiet premarket / after close)";
    }
    return `no prints in ${win}${minTxt}${act.length ? " with " + act.join(" · ") : ""}${sug}`;
  }
  function oiEmptyMsg() {
    const h = [];
    if (sev !== "all") h.push(SEV_LABEL[sev] || sev);
    if (onlyNew) h.push("new only");
    if (onlyWatch) h.push("★ watchlist only");
    if (fType !== "all") h.push(fType === "call" ? "Calls only" : "Puts only");
    if (fExpiry === "today") h.push("exp today");
    else if (fExpiry === "week") h.push("exp ≤7d");
    if (fClasses.size < CLASSES.length) h.push([...fClasses].map((c) => CLASS_LABEL[c] || c).join("/"));
    if (hideMuted) h.push("hiding muted");
    return h.length ? `no OI builds match ${h.join(" · ")} — pick All / widen the filters` : "no OI builds for this session";
  }

  U.renderAlerts = async function (root) {
    alertView = A.alertView();
    ensureAvStyle();
    const nav = U.navSeq || 0;
    liveMin = A.liveMin();
    const mounted = root.querySelector("[data-alerts-view]");
    const first = !mounted; // only show the placeholder when the view isn't mounted yet
    if (first) root.innerHTML = '<div class="tabgrid snap"><div class="card c4"><div class="body muted" style="padding:10px">Loading alerts…</div></div></div>';
    let d, dl;
    try {
      const ra = await fetch("/api/alerts");
      if (!ra.ok) throw new Error("HTTP " + ra.status);
      d = await ra.json();
      if (isLiveRange()) {
        const rl = await fetch("/api/live?min=" + liveMin);
        dl = rl.ok ? await rl.json() : { alerts: [], counts: {} };
      } else {
        // persisted sqlite history, shown in the SAME table
        const since = rangeSince();
        const rr = await fetch("/api/alerts/history?limit=300" + (since ? "&since=" + encodeURIComponent(since) : ""));
        const j = rr.ok ? await rr.json() : { rows: [] };
        const rows = (j.rows || []).map((x) => ({
          id: x.id, kind: x.kind, ticker: x.ticker, asset_class: x.asset_class, type: x.type, strike: x.strike,
          expiry: x.expiry, premium: x.premium, size: x.size, volume: x.volume, oi: x.oi, vol_oi: x.vol_oi,
          sweep: !!x.sweep, side: x.side, rule: x.rule, created_at: x.event_ts,
        }));
        const counts = { flow: 0, unusual: 0, darkpool: 0, oi: 0 };
        rows.forEach((r) => { counts[r.kind] = (counts[r.kind] || 0) + 1; });
        dl = { generated_at: (j.stats && j.stats.latest) || new Date().toISOString(), counts, alerts: rows, range: liveRange };
      }
    } catch (e) {
      if (first) root.innerHTML = `<div class="tabgrid snap"><div class="card c4"><div class="body err">Failed: ${esc(e.message)}</div></div></div>`;
      return;
    }
    if ((U.navSeq || 0) !== nav) return; // route changed while loading — don't mark seen
    // If nothing changed since the last poll, leave the DOM completely untouched
    // (no flicker, no scroll jump) — only repaint when there is actually new data.
    const sig = [d.generated_at, dl.generated_at, (d.alerts || []).length, (dl.alerts || []).length, liveMin, liveRange, alertView].join("|");
    if (!first && sig === U._alertsSig) {
      if (U.startAlerts) U.startAlerts();
      armView(root);
      return;
    }
    U._alertsSig = sig;
    const alerts = d.alerts || [];
    // live mode applies the min-premium cut; history is a complete record
    const live = isLiveRange() ? withinWindow((dl.alerts || []).filter((a) => (Number(a.premium) || 0) >= liveMin)) : dl.alerts || [];
    const seen0 = new Set(A.seen());
    const freshAlerts = alerts.filter((a) => !seen0.has(a.id));
    const freshIds = new Set(freshAlerts.map((a) => a.id));
    // unread that would actually ring: muted tickers never notify, so they are
    // shown separately and never inflate the bell / KPI counts
    const freshUnread = freshAlerts.filter((a) => !A.isMuted(a.ticker)).length;
    const freshMutedN = freshAlerts.length - freshUnread;
    const liveSeen0 = new Set(A.liveSeen());
    const liveFreshAlerts = isLiveRange() ? live.filter((a) => !liveSeen0.has(a.id)) : [];
    const liveFresh = new Set(liveFreshAlerts.map((a) => a.id));
    const liveFreshUnread = liveFreshAlerts.filter((a) => !A.isMuted(a.ticker)).length;
    const liveFreshMutedN = liveFreshAlerts.length - liveFreshUnread;

    function f(row) {
      if (!passCommon(row)) return false;
      if (hideMuted && A.isMuted(row.ticker)) return false;
      if (sev !== "all" && row.severity !== sev) return false;
      if (onlyNew && !freshIds.has(row.id)) return false;
      if (onlyWatch && !(U.watch && U.watch.has(row.ticker))) return false;
      return true;
    }

    function fLive(row) {
      if (!passCommon(row)) return false;
      if (fSweep && !row.sweep) return false;
      if (hideMuted && A.isMuted(row.ticker)) return false;
      if (liveKind !== "all" && row.kind !== liveKind) return false;
      if (liveOnlyWatch && !(U.watch && U.watch.has(row.ticker))) return false;
      return true;
    }

    function paint() {
      const prevView = root.querySelector("[data-alerts-view]");
      const prevScroll = prevView ? prevView.scrollTop : 0;
      const prevLive = root.querySelector("[data-live-body]");
      const prevLiveScroll = prevLive ? prevLive.scrollTop : 0;
      // only rows that were NOT rendered last time are "new" and get the flash
      const oiIds = alerts.map((a) => a.id);
      const oiNew = oiRendered ? new Set(oiIds.filter((id) => !oiRendered.has(id))) : new Set();
      const liveIds = (dl.alerts || []).map((a) => a.id);
      const liveNew = isLiveRange() && liveRendered ? new Set(liveIds.filter((id) => !liveRendered.has(id))) : new Set();
      const rows = alerts.filter(f).slice(0, 25);
      const counts = d.counts || {};
      const wlIds = new Set(U.watch ? U.watch.list() : []);
      const notice = wlIds.size
        ? `<span class="badge" style="border-color:rgba(245,158,11,.5);color:var(--warn)">★ ${wlIds.size} watched</span>`
        : "";
      const head =
        `<tr><th>Sev</th><th></th><th>Ticker</th><th>Type</th><th>Contract</th><th>Exp</th><th class="num">Strike</th><th class="num">OI ×</th><th class="num">+OI</th><th class="num">OI now</th><th class="num">Vol</th><th class="num">Vol/OI</th><th class="num">Fresh $</th><th class="num">Days↑</th></tr>`;
      const body = rows.length
        ? rows
            .map((a) => {
              const isNew = freshIds.has(a.id);
              const onWatch = wlIds.has(a.ticker);
              return `<tr class="${oiNew.has(a.id) ? "row-new" : ""}">
                <td>${sevPill(a.severity)}</td>
                <td>${isNew ? '<span class="pill new">NEW</span>' : ""}${onWatch ? '<span class="warn" title="on your watchlist">★</span>' : ""}</td>
                <td>${tk(a.ticker)}${A.isMuted(a.ticker) ? ' <span class="pill">MUTED</span>' : ""}</td>
                <td class="${typeCls(a.type)}">${String(a.type).toUpperCase()}</td>
                <td class="muted" title="${esc(a.contract || "")}">${esc(U.util.occ(a.contract))}</td>
                <td class="muted">${esc((a.expiry || "").slice(5))}</td>
                <td class="num">${esc(a.strike)}</td>
                <td class="num ${a.oi_ratio >= 2 ? "pos" : ""}" style="background:${U.heat(a.oi_ratio, 4)}">${num(a.oi_ratio, 2)}</td>                <td class="num ${signCls(a.oi_delta)}">${int(a.oi_delta)}</td>
                <td class="num muted">${int(a.curr_oi)}</td>
                <td class="num" style="background:${U.heat(a.volume, 300000)}">${int(a.volume)}</td>
                <td class="num ${a.vol_oi != null && a.vol_oi >= 1 ? "warn" : "muted"}">${a.vol_oi == null ? "–" : num(a.vol_oi, 2) + "x"}</td>
                <td class="num">${money(a.notional)}</td>
                <td class="num muted">${int(a.days_of_oi_increases)}</td>
              </tr>`;
            })
            .join("")
        : `<tr><td colspan="14" class="muted" style="padding:8px">${esc(oiEmptyMsg())}</td></tr>`;

      // raw vs cluster share ONE filter pipeline (live range/min already applied
      // upstream, then fLive); cluster then groups the filtered rows by ticker.
      const lfiltered = live.filter(fLive);
      const isCluster = alertView === "cluster";
      const cl = isCluster ? clusterAlerts(lfiltered) : [];
      const lrows = isCluster ? [] : lfiltered.slice(0, isLiveRange() ? 40 : 200);
      const freshTickers = new Set(lfiltered.filter((a) => liveFresh.has(a.id)).map((a) => a.ticker));
      const lmax = Math.max(1, ...lrows.map((r) => Number(r.premium) || 0));
      const gmax = Math.max(1, ...cl.map((g) => Math.abs(g.net)));
      let lhead;
      let lbody;
      if (isCluster) {
        // columns: Ticker | Net $ | Call $ | Put $ | Bias | Exp(nearest+DTE) | # | ⚡ | Last
        lhead = `<tr><th>Ticker</th><th class="num">Net $</th><th class="num">Call $</th><th class="num">Put $</th><th>Bias</th><th>Exp</th><th class="num" title="print count">#</th><th class="num" title="sweep count">⚡</th><th class="num">Last</th></tr>`;
        lbody = cl.length
          ? cl
              .map((g) => {
                const expTxt = g.exp ? `${esc(g.exp.slice(5, 10))} · ${g.dte == null ? "?" : int(g.dte)}d` : "—";
                const bias =
                  g.bias === "bull"
                    ? '<span class="chip bull">BULL</span>'
                    : g.bias === "bear"
                    ? '<span class="chip bear">BEAR</span>'
                    : '<span class="chip mix">MIX</span>';
                const top = g.top
                  .map(
                    (p) =>
                      `${p.strike == null || p.strike === "" ? "–" : esc(p.strike)}${p.type === "call" ? "C" : p.type === "put" ? "P" : ""} ${
                        p.expiry ? esc(String(p.expiry).slice(5, 10)) : ""
                      } ${money(p.premium)}`
                  )
                  .join(" · ");
                const tt =
                  `${g.ticker} — ${int(g.count)} prints${g.other ? " (" + int(g.other) + " dark)" : ""}, net ${money(g.net)}` +
                  (top ? `. Top prints: ${top}` : " · darkpool only");
                return `<tr class="${freshTickers.has(g.ticker) ? "row-new" : ""}" title="${esc(tt)}">
                  <td>${tk(g.ticker)}${A.isMuted(g.ticker) ? ' <span class="pill">MUTED</span>' : ""}</td>
                  <td class="num ${signCls(g.net)}" style="background:${U.heat(g.net, gmax)}">${money(g.net)}</td>
                  <td class="num">${money(g.call)}</td>
                  <td class="num">${money(g.put)}</td>
                  <td>${bias}</td>
                  <td class="muted">${expTxt}</td>
                  <td class="num">${int(g.count)}</td>
                  <td class="num ${g.sweeps ? "warn" : "muted"}">${g.sweeps ? int(g.sweeps) : ""}</td>
                  <td class="num muted">${esc(ago(g.last))}</td>
                </tr>`;
              })
              .join("")
          : `<tr><td colspan="9" class="muted" style="padding:8px">${esc(liveEmptyMsg())}</td></tr>`;
      } else {
        lhead = `<tr><th>Ago</th><th>Kind</th><th>Ticker</th><th>Type</th><th class="num">Strike</th><th>Exp</th><th class="num" title="Contracts × price × 100. For UNUSUAL this is the contract's cumulative traded premium for the session, not a single order.">Premium</th><th class="num" title="Size in contracts (volume traded on the contract)">Size ct</th><th>⚡</th><th>Side</th><th>Rule</th></tr>`;
        lbody = lrows.length
          ? lrows
              .map(
                (a) => `<tr class="${liveNew.has(a.id) ? "row-new" : ""}">
                <td class="muted" title="${esc(a.created_at || "")}">${esc(ago(a.created_at))}</td>
                <td class="muted">${esc(KIND_LABEL[a.kind] || a.kind)}</td>
                <td>${tk(a.ticker)}${A.isMuted(a.ticker) ? ' <span class="pill">MUTED</span>' : ""}${liveFresh.has(a.id) ? ' <span class="pill new">NEW</span>' : ""}</td>
                <td class="${typeCls(a.type)}">${esc(String(a.type || "–").toUpperCase())}</td>
                <td class="num">${a.strike == null ? "–" : esc(a.strike)}</td>
                <td class="muted">${esc((a.expiry || "").slice(5))}</td>
                <td class="num" style="background:${U.heat(Number(a.premium) || 0, lmax)}">${money(a.premium)}</td>
                <td class="num muted">${int(a.size)}</td>
                <td class="${a.sweep ? "warn" : "muted"}">${a.sweep ? "⚡" : ""}</td>
                <td class="muted">${esc(a.side || "–")}</td>
                <td class="muted">${esc(a.rule || a.kind)}</td>
              </tr>`
              )
              .join("")
          : `<tr><td colspan="11" class="muted" style="padding:8px">${esc(liveEmptyMsg())}</td></tr>`;
      }

      const lc = lfiltered.reduce((m, a) => ((m[a.kind] = (m[a.kind] || 0) + 1), m), { flow: 0, unusual: 0, darkpool: 0, oi: 0 });
      const clScope = isCluster ? `${int(cl.length)} names · ${int(lfiltered.length)} prints` : `${int(lrows.length)}/${int(lfiltered.length)} prints`;
      // persistent muted-ticker badge — visible even when the filter bar is
      // collapsed, and clickable to expand it and manage the mute list
      const mutedList = A.muted();
      const mutedBadge = mutedList.length
        ? `<span class="pill" data-muted-badge title="${esc(
            "Desktop, sound and Telegram alerts are suppressed for: " + mutedList.join(", ") + " — click to manage the mute list"
          )}" style="cursor:pointer;border-color:rgba(245,158,11,.5);color:var(--warn)">🔇 muted: ${esc(mutedList.join(" "))}</span>`
        : "";
      const liveCard = `<div class="card c4" style="flex:1 1 auto;min-height:200px">
        <h2>⚡ Alerts · ${isCluster ? "Clusters" : "Raw tape"} · ${isLiveRange() ? (liveRange === "live" ? "live" : "last " + liveRange) : liveRange + " (sqlite)"} <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">${clScope} · flow ${int(lc.flow)} · unusual ${int(lc.unusual)} · dark ${int(lc.darkpool)}${
        lc.oi ? " · oi " + int(lc.oi) : ""
      } · ${isLiveRange() ? "min " + money(liveMin) : "persisted"} · updated ${esc(ago(dl.generated_at))} ago</span> <span class="hint-i" title="Plain-English">i</span>${mutedBadge ? " " + mutedBadge : ""}</h2>
        <div class="hint"><b>Cluster</b> (default) = one row per ticker: <b>Net $</b> = call premium − put premium (net directional spend), heat-coloured; <b>Bias</b> is BULL / BEAR when |net| clears <b>15% of call+put premium</b>, else MIX; <b>Exp</b> = nearest expiry + days-to-expiry. <b>Raw</b> = every individual print. Real-time during the session — unlike <b>OI</b>, which the API updates only once a day (~06:45 ET). <b>FLOW</b> = rule-based tape alerts on one contract (sweeps / repeated hits) — closest to a single actor; <b>UNUSUAL</b> = a contract flagged as unusually active, where <b>Premium is that contract's cumulative traded premium today (not one order)</b>; <b>DARK</b> = off-exchange blocks. <b>⚡</b> = sweep (aggressive, multi-exchange). <b>Size ct</b> = contracts. <b>Side</b> is inferred from ask- vs bid-side premium (call+buy = bullish). Use the <b>Live / 5m / 10m / 30m / 1h / Today / All</b> range to mix in persisted (sqlite) history; filter by asset class, Calls/Puts, expiry (Today / ≤7d) and sweeps — every filter applies in <b>both</b> views.</div>
        <div class="body" data-live-body>
          <div class="kpis">
            <div class="kpi"><div class="kpi-l">Prints</div><div class="kpi-v">${int(lfiltered.length)}</div><div class="kpi-s">≥ ${money(liveMin)}</div></div>
            <div class="kpi"><div class="kpi-l">Names</div><div class="kpi-v">${int(cl.length)}</div><div class="kpi-s">${isCluster ? "clustered" : "raw rows"}</div></div>
            <div class="kpi"><div class="kpi-l">Flow</div><div class="kpi-v">${int(lc.flow)}</div><div class="kpi-s">tape alerts</div></div>
            <div class="kpi"><div class="kpi-l">Unusual</div><div class="kpi-v">${int(lc.unusual)}</div><div class="kpi-s">contracts</div></div>
            <div class="kpi"><div class="kpi-l">Unread</div><div class="kpi-v ${liveFreshUnread ? "neg" : ""}">${int(liveFreshUnread)}</div><div class="kpi-s">new since last look${liveFreshMutedN ? " · " + int(liveFreshMutedN) + " muted" : ""}</div></div>
          </div>
          <div class="presets">
            <button class="preset ${filtersOpen ? "on" : ""}" data-ft="1" title="Show / hide all filters">${filtersOpen ? "▾ Filters" : "▸ Filters"}</button>
            <span style="width:8px"></span>
            ${RANGES.map((r) => `<button class="preset ${liveRange === r.id ? "on" : ""}" data-fr="${r.id}" title="${LIVE_RANGES.indexOf(r.id) >= 0 ? "Live feed" : "Persisted history (sqlite)"}">${r.label}</button>`).join("")}
            <span style="width:8px"></span>
            <button class="preset ${alertView === "cluster" ? "on" : ""}" data-av="cluster" title="One row per ticker — net call−put premium, nearest expiry, print + sweep counts">Cluster</button>
            <button class="preset ${alertView === "raw" ? "on" : ""}" data-av="raw" title="Every individual print, newest first">Raw</button>
            ${isCluster ? `<span class="pill" title="individual prints compressed into these clusters">Raws ${int(lfiltered.length)}</span>` : ""}
            <span style="width:8px"></span>
            ${
              filtersOpen
                ? `<button class="preset ${liveKind === "all" ? "on" : ""}" data-lk="all">All</button>
            <button class="preset ${liveKind === "flow" ? "on" : ""}" data-lk="flow">Flow</button>
            <button class="preset ${liveKind === "unusual" ? "on" : ""}" data-lk="unusual">Unusual</button>
            <button class="preset ${liveKind === "darkpool" ? "on" : ""}" data-lk="darkpool">Dark pool</button>
            <button class="preset ${liveKind === "oi" ? "on" : ""}" data-lk="oi">OI</button>
            <span style="width:8px"></span>
            ${CLASSES.map((c) => `<button class="preset ${fClasses.has(c) ? "on" : ""}" data-fc="${c}">${CLASS_LABEL[c]}</button>`).join("")}
            <span style="width:8px"></span>
            <button class="preset ${fType === "all" ? "on" : ""}" data-ftp="all">All</button>
            <button class="preset ${fType === "call" ? "on" : ""}" data-ftp="call">Calls</button>
            <button class="preset ${fType === "put" ? "on" : ""}" data-ftp="put">Puts</button>
            <span style="width:8px"></span>
            <button class="preset ${fExpiry === "all" ? "on" : ""}" data-fx="all">All exp</button>
            <button class="preset ${fExpiry === "today" ? "on" : ""}" data-fx="today">Today</button>
            <button class="preset ${fExpiry === "week" ? "on" : ""}" data-fx="week">≤7d</button>
            <button class="preset ${fSweep ? "on" : ""}" data-fs="1">⚡ Sweeps</button>
            <span style="width:8px"></span>
            <button class="preset ${liveOnlyWatch ? "on" : ""}" data-lw="1">★ Watchlist</button>
            <button class="preset ${hideMuted ? "on" : ""}" data-hm="1" title="Hide alerts from muted tickers in these tables">Hide muted</button>
            <span class="muted" style="padding:0 4px">min:</span>
            ${[250000, 500000, 1000000].map((m) => `<button class="preset ${liveMin === m ? "on" : ""}" data-lm="${m}">${money(m)}</button>`).join("")}
            <button class="preset" id="al-mute-live">Mark live read</button>
            <span class="muted" style="padding:0 4px">mute:</span>
            ${A.muted().map((m) => `<span class="pill" data-unmute="${esc(m)}" title="click to unmute" style="cursor:pointer;border-color:rgba(245,158,11,.5)">${esc(m)} ✕</span>`).join(" ") || '<span class="muted">none</span>'}
            <input id="al-mute-add" placeholder="ticker" autocomplete="off" spellcheck="false" style="background:var(--panel2);border:1px solid var(--border);border-radius:4px;color:var(--text);font:inherit;font-size:10px;padding:1px 6px;width:80px" />
            <button class="preset" id="al-mute-add-btn">Mute</button>`
                : `<span class="muted" style="padding:0 4px">${clScope} · min ${money(liveMin)}${fSweep ? " · sweeps" : ""}${
                    fExpiry !== "all" ? " · exp " + fExpiry : ""
                  } · filters hidden</span>`
            }
          </div>
          <table class="av-table"><thead>${lhead}</thead><tbody>${lbody}</tbody></table>
          ${!isCluster && lfiltered.length > lrows.length ? `<div class="wl-note">showing ${lrows.length} of ${lfiltered.length} prints — switch to <b>Cluster</b> to see every name</div>` : ""}
        </div>
      </div>`;

      root.innerHTML = `<div data-alerts-view style="height:100%;overflow:auto"><div class="av-stack" style="display:flex;flex-direction:column;gap:5px;padding:5px;height:100%;min-height:0">
        <div class="card c4" style="flex:0 0 auto;max-height:38vh">
          <h2>OI-change alerts · fresh positioning <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">session ${esc(d.session || "–")} · ${alerts.length} builds · updated ${esc(ago(d.generated_at))} ago</span> <span class="hint-i" title="Plain-English">i</span></h2>
          <div class="hint">Market-wide <b>open-interest</b> builds vs the prior session (<b>/api/market/oi-change</b>). <b>OI ×</b> = current OI ÷ prior OI (a 3× means the position tripled); <b>+OI</b> = contracts added; <b>Vol/OI</b> ≥ 1 means more traded today than existed before (brand-new positioning); <b>Fresh $</b> ≈ contracts added × average price × 100. Severity: <b>CRITICAL</b> = +30k OI on ≥25k volume (or a ≥5× jump on ≥10k vol), <b>HIGH</b> = +15k OI on ≥15k volume or a ≥3× jump. Options data is for the most recent <b>completed session</b>.</div>
          <div class="body">
            <div class="kpis">
              <div class="kpi"><div class="kpi-l">Alerts</div><div class="kpi-v">${int(alerts.length)}</div><div class="kpi-s">${d.total != null ? d.total + " in full list" : ""}</div></div>
              <div class="kpi"><div class="kpi-l">Critical</div><div class="kpi-v neg">${int(counts.critical)}</div><div class="kpi-s">OI ≥ 2×</div></div>
              <div class="kpi"><div class="kpi-l">High</div><div class="kpi-v warn">${int(counts.high)}</div><div class="kpi-s">big builds</div></div>
              <div class="kpi"><div class="kpi-l">Watch</div><div class="kpi-v">${int(counts.watch)}</div><div class="kpi-s">smaller builds</div></div>
              <div class="kpi"><div class="kpi-l">Unread</div><div class="kpi-v ${freshUnread ? "neg" : ""}">${int(freshUnread)}</div><div class="kpi-s">new since last look${freshMutedN ? " · " + int(freshMutedN) + " muted" : ""}</div></div>
              <div class="kpi"><div class="kpi-l">Tickers</div><div class="kpi-v">${int((d.tickers || []).length)}</div><div class="kpi-s">covered</div></div>
            </div>
            <div class="presets">
              <button class="preset ${filtersOpen ? "on" : ""}" data-ft="1" title="Show / hide filters">${filtersOpen ? "▾ Filters" : "▸ Filters"}</button>
              ${
                filtersOpen
                  ? `<button class="preset ${sev === "all" ? "on" : ""}" data-sev="all">All</button>
              ${SEV.map((s) => `<button class="preset ${sev === s ? "on" : ""}" data-sev="${s}">${SEV_LABEL[s]}</button>`).join("")}
              <button class="preset ${onlyNew ? "on" : ""}" data-an="1">New only</button>
              <button class="preset ${onlyWatch ? "on" : ""}" data-aw="1">★ My watchlist</button>
              ${notice}`
                  : `<span class="muted" style="padding:0 4px">${rows.length}/${alerts.length} OI builds · filters hidden</span>`
              }
              <span class="spacer" style="flex:1"></span>
              <button class="preset ${A.notifyOn() ? "on" : ""}" id="al-notify" title="Browser desktop notifications for new high/critical alerts">🔔 Desktop alerts ${A.notifyOn() ? "on" : "off"}</button>
              <button class="preset ${A.soundOn() ? "on" : ""}" id="al-sound" title="Play a short beep for new high/critical alerts">♪ Sound ${A.soundOn() ? "on" : "off"}</button>
              <button class="preset ${A.telegramOn() ? "on" : ""}" id="al-telegram" title="Mirror new live prints + high OI builds to your Telegram">✈ Telegram ${A.telegramOn() ? "on" : "off"}</button>
              <button class="preset" id="al-test" title="Fire a sample desktop notification + sound to verify they work">🔔♪ Test</button>
              ${U._notifyLast || U._tgLast ? `<span class="muted" style="padding:0 4px">last alert ${esc(ago(new Date(Math.max(U._notifyLast || 0, U._tgLast || 0)).toISOString()))} ago</span>` : ""}
              <button class="preset" id="al-mute">Mark all read</button>
            </div>
            <table><thead>${head}</thead><tbody>${body}</tbody></table>
            ${alerts.length > rows.length ? `<div class="wl-note">showing ${rows.length} of ${alerts.length} builds</div>` : ""}
          </div>
        </div>
        ${liveCard}
      </div></div>`;
      root.querySelectorAll("[data-sev]").forEach((b) => {
        b.onclick = () => {
          sev = b.dataset.sev;
          paint();
        };
      });
      root.querySelectorAll("[data-av]").forEach((b) => {
        b.onclick = () => {
          const v = b.dataset.av;
          if (v === "cluster" || v === "raw") {
            alertView = v;
            A.setAlertView(v);
            paint();
          }
        };
      });
      const bn = root.querySelector("[data-an]");
      if (bn)
        bn.onclick = () => {
          onlyNew = !onlyNew;
          paint();
        };
      const bw = root.querySelector("[data-aw]");
      if (bw)
        bw.onclick = () => {
          onlyWatch = !onlyWatch;
          paint();
        };
      root.querySelectorAll("[data-lk]").forEach((b) => {
        b.onclick = () => {
          liveKind = b.dataset.lk;
          paint();
        };
      });
      const lw = root.querySelector("[data-lw]");
      if (lw)
        lw.onclick = () => {
          liveOnlyWatch = !liveOnlyWatch;
          paint();
        };
      root.querySelectorAll("[data-lm]").forEach((b) => {
        b.onclick = () => {
          liveMin = Number(b.dataset.lm);
          A.setLiveMin(liveMin);
          U.renderAlerts(root);
        };
      });
      root.querySelectorAll("[data-ft]").forEach((b) => {
        b.onclick = () => {
          filtersOpen = !filtersOpen;
          try {
            localStorage.setItem("uw_alert_filters", filtersOpen ? "1" : "0");
          } catch (e) {
            /* ignore */
          }
          paint();
        };
      });
      root.querySelectorAll("[data-fr]").forEach((b) => {
        b.onclick = () => {
          liveRange = b.dataset.fr;
          try {
            localStorage.setItem("uw_alert_range", liveRange);
          } catch (e) {
            /* ignore */
          }
          U.renderAlerts(root);
        };
      });
      root.querySelectorAll("[data-fc]").forEach((b) => {
        b.onclick = () => {
          const c = b.dataset.fc;
          const s = new Set(fClasses);
          if (s.has(c)) s.delete(c);
          else s.add(c);
          if (!s.size) CLASSES.forEach((x) => s.add(x)); // never hide everything
          setClasses(s);
          paint();
        };
      });
      root.querySelectorAll("[data-ftp]").forEach((b) => {
        b.onclick = () => {
          fType = b.dataset.ftp;
          paint();
        };
      });
      root.querySelectorAll("[data-fx]").forEach((b) => {
        b.onclick = () => {
          fExpiry = b.dataset.fx;
          paint();
        };
      });
      const fsBtn = root.querySelector("[data-fs]");
      if (fsBtn)
        fsBtn.onclick = () => {
          fSweep = !fSweep;
          paint();
        };
      const muteLive = root.querySelector("#al-mute-live");
      if (muteLive)
        muteLive.onclick = () => {
          A.markLiveSeen(live.map((a) => a.id));
          U.updateAlertBadge(0);
          U.renderAlerts(root);
        };
      const hm = root.querySelector("[data-hm]");
      if (hm)
        hm.onclick = () => {
          hideMuted = !hideMuted;
          paint();
        };
      // click the persistent "muted" badge in the live-card header to expand the
      // filter bar (where the mute manager chips live) even when it is collapsed
      const mutedBadgeEl = root.querySelector("[data-muted-badge]");
      if (mutedBadgeEl)
        mutedBadgeEl.onclick = () => {
          filtersOpen = true;
          try {
            localStorage.setItem("uw_alert_filters", "1");
          } catch (e) {
            /* ignore */
          }
          paint();
        };
      root.querySelectorAll("[data-unmute]").forEach((el) => {
        el.onclick = () => {
          A.removeMuted(el.dataset.unmute);
          paint();
        };
      });
      const muteAdd = root.querySelector("#al-mute-add-btn");
      const muteInp = root.querySelector("#al-mute-add");
      const doMute = () => {
        const v = (muteInp && muteInp.value) || "";
        if (v.trim()) {
          A.addMuted(v);
          paint();
        }
      };
      if (muteAdd) muteAdd.onclick = doMute;
      if (muteInp)
        muteInp.onkeydown = (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            doMute();
          }
        };
      const notify = root.querySelector("#al-notify");
      if (notify)
        notify.onclick = () => {
          const turningOn = !A.notifyOn();
          if (turningOn && "Notification" in window && Notification.permission !== "granted") {
            try {
              Promise.resolve(Notification.requestPermission())
                .then((p) => {
                  if (p === "granted") {
                    A.set(KEY_NOTIFY, true);
                    paint();
                  }
                })
                .catch(() => {});
            } catch (e) {
              /* notifications unavailable */
            }
            return;
          }
          A.set(KEY_NOTIFY, turningOn);
          paint();
        };
      const sound = root.querySelector("#al-sound");
      if (sound)
        sound.onclick = () => {
          A.set(KEY_SOUND, !A.soundOn());
          if (A.soundOn()) beep();
          paint();
        };
      const tg = root.querySelector("#al-telegram");
      if (tg)
        tg.onclick = async () => {
          const turningOn = !A.telegramOn();
          if (turningOn) {
            let st = { configured: false };
            try {
              st = await (await fetch("/api/telegram")).json();
            } catch (e) {
              /* ignore */
            }
            if (!st || !st.configured) {
              alert("Telegram is not configured on the server.\nSet TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, then restart the dashboard.");
              return;
            }
            // fire a confirmation so the user can verify the pipe immediately
            try {
              const r = await (
                await fetch("/api/telegram", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ test: true }),
                })
              ).json();
              if (r && r.ok) U._tgLast = Date.now();
            } catch (e) {
              /* ignore */
            }
          }
          A.set(KEY_TELEGRAM, turningOn);
          paint();
        };
      const tst = root.querySelector("#al-test");
      if (tst)
        tst.onclick = () => {
          if (U.testAlert) U.testAlert();
          paint();
        };
      const mute = root.querySelector("#al-mute");
      if (mute)
        mute.onclick = () => {
          A.markSeen(alerts.map((a) => a.id));
          A.markLiveSeen((dl.alerts || []).map((a) => a.id));
          U.updateAlertBadge(0);
          U.renderAlerts(root);
        };
      // remember what we rendered (next diff) + restore scroll so the repaint doesn't jump
      oiRendered = new Set(oiIds);
      liveRendered = new Set(liveIds);
      const v = root.querySelector("[data-alerts-view]");
      if (v) v.scrollTop = prevScroll;
      const nb = root.querySelector("[data-live-body]");
      if (nb) nb.scrollTop = prevLiveScroll;
    }

    paint();
    // everything currently listed is "seen" once the section is opened
    A.markSeen(alerts.map((a) => a.id));
    A.markLiveSeen((dl.alerts || []).map((a) => a.id));
    U.updateAlertBadge(0);
    U.startAlerts();
    armView(root);
  };
})();

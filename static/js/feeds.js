/* feeds.js — REST client (auth-aware) + the transport router for live ticks.
 *
 * A source declares its transport in data_source.py:
 *   {"kind": "poll", "interval_ms": 4000}   -> batched GET /api/quotes
 *
 * ADDING A NEW TRANSPORT: add one `case` in Feeds.subscribe below.
 * Polled sources need nothing here at all.
 */
(function (global) {
  'use strict';

  /* Same-origin by default. Set window.API_BASE in index.html when the
   * frontend is hosted separately (Firebase Hosting / GitHub Pages). */
  const base = () => (global.API_BASE || '').replace(/\/$/, '');

  const api = {
    async json(path, options) {
      const opts = Object.assign({ headers: {} }, options);
      opts.headers = Object.assign({ Accept: 'application/json' }, opts.headers);

      const token = global.Auth ? await global.Auth.token() : null;
      if (token) opts.headers.Authorization = 'Bearer ' + token;
      if (opts.body && typeof opts.body !== 'string') {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(opts.body);
      }

      const res = await fetch(base() + path, opts);
      const body = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) {
        if (global.Auth) global.Auth.onRejected(body.error || 'not authorised');
        throw new Error(body.error || 'not authorised');
      }
      if (!res.ok) throw new Error(body.error || res.status + ' ' + res.statusText);
      return body;
    },

    config()  { return api.json('/api/config'); },
    sources() { return api.json('/api/sources'); },
    settings() { return api.json('/api/settings'); },
    post(path, body) { return api.json(path, { method: 'POST', body: body || {} }); },

    candles(source, symbol, timeframe, limit, indicators) {
      return api.json('/api/candles?source=' + encodeURIComponent(source) +
        '&symbol=' + encodeURIComponent(symbol) +
        '&timeframe=' + encodeURIComponent(timeframe) +
        '&limit=' + (limit || 500) +
        (indicators ? '&indicators=' + encodeURIComponent(indicators) : ''));
    },
    quotes(source, symbols) {
      return api.json('/api/quotes?source=' + encodeURIComponent(source) +
        '&symbols=' + encodeURIComponent(symbols.join(',')));
    },
  };

  /* ---------------------------------------------------------------------
   * Poller: one timer per source, one request per tick for ALL its symbols.
   * ------------------------------------------------------------------- */
  const Poller = {
    groups: new Map(),
    statusHandlers: new Set(),
    state: 'idle',

    onStatus(fn) { this.statusHandlers.add(fn); fn(this.state); return () => this.statusHandlers.delete(fn); },
    _setState(s) {
      if (this.state === s) return;
      this.state = s;
      this.statusHandlers.forEach((fn) => { try { fn(s); } catch (_) {} });
    },

    add(source, symbol, handler) {
      let g = this.groups.get(source.key);
      if (!g) {
        g = { subs: new Map(), intervalMs: source.stream.interval_ms || 5000, timer: null, busy: false };
        this.groups.set(source.key, g);
        g.timer = setInterval(() => this._tick(source.key), g.intervalMs);
        this._tick(source.key);
      }
      if (!g.subs.has(symbol)) g.subs.set(symbol, new Set());
      g.subs.get(symbol).add(handler);

      let done = false;
      return () => {
        if (done) return;
        done = true;
        const set = g.subs.get(symbol);
        if (!set) return;
        set.delete(handler);
        if (!set.size) g.subs.delete(symbol);
        if (!g.subs.size) { clearInterval(g.timer); this.groups.delete(source.key); }
      };
    },

    async _tick(sourceKey) {
      const g = this.groups.get(sourceKey);
      if (!g || g.busy || !g.subs.size || document.hidden) return;
      g.busy = true;
      try {
        const symbols = Array.from(g.subs.keys());
        const { quotes } = await api.quotes(sourceKey, symbols);
        this._setState('live');
        Object.keys(quotes || {}).forEach((sym) => {
          const set = g.subs.get(sym);
          if (!set) return;
          set.forEach((fn) => { try { fn(quotes[sym]); } catch (err) { console.error(err); } });
        });
      } catch (err) {
        this._setState('down');
        console.warn('[poll:' + sourceKey + ']', err.message);
      } finally {
        g.busy = false;
      }
    },

    stopAll() {
      this.groups.forEach((g) => clearInterval(g.timer));
      this.groups.clear();
    },
  };

  const Feeds = {
    api,
    Poller,

    /**
     * Wire up live data for one pane.
     * cb.onPrice({price, time})     — every tick, for the ticker bar
     * cb.onCandle({time,open,...})  — when the transport delivers real bars
     */
    subscribe(source, symbol, timeframe, cb) {
      const offs = [];
      switch (source.stream.kind) {
        /* case 'some_broker_ws': open your socket, call cb.onCandle / cb.onPrice */
        case 'poll':
        default:
          offs.push(Poller.add(source, symbol, (q) => {
            if (!q || typeof q.price !== 'number') return;
            cb.onPrice && cb.onPrice(q);
          }));
          break;
      }
      return () => offs.forEach((off) => { try { off(); } catch (_) {} });
    },

    statusFor(source, fn) { return Poller.onStatus(fn); },
  };

  global.Feeds = Feeds;
})(window);

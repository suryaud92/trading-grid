/* app.js — grid layout, the chart-count selector, and persistence.
 * App.start() is called by auth.js once the viewer is allowed in. */
(function (global) {
  'use strict';

  const COUNTS = [1, 2, 4, 6, 8];
  const STORE_KEY = 'ltg.state.v3';
  const MAX_PANES = 8;

  const App = {
    sources: {},
    customSymbols: {},
    panes: [],
    state: { count: 4, configs: [] },

    /* --------------------------------------------------------- storage */
    load() {
      try {
        const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
        if (COUNTS.indexOf(saved.count) !== -1) this.state.count = saved.count;
        if (Array.isArray(saved.configs)) this.state.configs = saved.configs;
        if (saved.customSymbols && typeof saved.customSymbols === 'object') {
          this.customSymbols = saved.customSymbols;
        }
      } catch (_) { /* corrupt or blocked storage: defaults */ }
    },

    save() {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          count: this.state.count,
          configs: this.state.configs,
          customSymbols: this.customSymbols,
        }));
      } catch (_) {}
    },

    /* --------------------------------------------------------- symbols */
    symbolsFor(sourceKey) {
      const src = this.sources[sourceKey];
      const extra = (this.customSymbols[sourceKey] || [])
        .map((s) => ({ symbol: s, label: s + ' (custom)' }));
      return extra.concat(src ? src.symbols : []);
    },

    addCustomSymbol(sourceKey, symbol) {
      const list = this.customSymbols[sourceKey] || (this.customSymbols[sourceKey] = []);
      if (list.indexOf(symbol) === -1) list.unshift(symbol);
      this.customSymbols[sourceKey] = list.slice(0, 20);
      this.save();
      this.panes.forEach((p) => { if (p.source.key === sourceKey) p.fillSymbols(); });
    },

    /* --------------------------------------------------------- configs */
    defaultConfigs() {
      const keys = Object.keys(this.sources);
      /* Prefer Zerodha when it's configured — it's the live one. */
      const preferred = this.sources.zerodha ? 'zerodha'
        : this.sources.yfinance ? 'yfinance' : keys[0];
      const picks = {
        zerodha: ['NSE:NIFTY 50', 'NSE:NIFTY BANK', 'NSE:RELIANCE', 'NSE:HDFCBANK',
                  'NSE:TCS', 'NSE:INFY', 'NSE:ICICIBANK', 'NSE:SBIN'],
        yfinance: ['^NSEI', '^NSEBANK', 'RELIANCE.NS', 'HDFCBANK.NS',
                   'TCS.NS', 'INFY.NS', 'ICICIBANK.NS', 'SBIN.NS'],
      };
      const src = this.sources[preferred];
      const list = picks[preferred] || [];
      return Array.from({ length: MAX_PANES }, (_, i) => {
        const symbol = list[i];
        const known = symbol && src.symbols.some((s) => s.symbol === symbol);
        return {
          source: src.key,
          symbol: known ? symbol : src.defaultSymbol,
          timeframe: src.defaultTimeframe,
          indicators: {},
        };
      });
    },

    normalizeConfigs() {
      const defaults = this.defaultConfigs();
      const out = [];
      for (let i = 0; i < MAX_PANES; i++) {
        const saved = this.state.configs[i];
        const src = saved && this.sources[saved.source];
        if (!src) { out.push(defaults[i]); continue; }
        out.push({
          source: src.key,
          symbol: saved.symbol || src.defaultSymbol,
          timeframe: src.timeframes.some((t) => t.id === saved.timeframe)
            ? saved.timeframe : src.defaultTimeframe,
          // keep only indicators the catalog still knows about
          indicators: Object.fromEntries(
            Object.entries(saved.indicators || {})
              .filter(([id]) => Indicators.CATALOG.some((c) => c.id === id))
          ),
        });
      }
      this.state.configs = out;
    },

    /* ------------------------------------------------------------ grid */
    renderCountPicker() {
      const host = document.getElementById('count-picker');
      host.innerHTML = '';
      COUNTS.forEach((n) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = String(n);
        b.title = n + ' chart' + (n > 1 ? 's' : '');
        b.setAttribute('aria-pressed', String(n === this.state.count));
        b.addEventListener('click', () => this.setCount(n));
        host.appendChild(b);
      });
    },

    setCount(n) {
      if (COUNTS.indexOf(n) === -1 || n === this.state.count) return;
      this.state.count = n;
      this.save();
      this.renderCountPicker();
      this.renderGrid();
    },

    renderGrid() {
      const grid = document.getElementById('grid');
      grid.dataset.count = String(this.state.count);
      while (this.panes.length > this.state.count) this.panes.pop().destroy();
      for (let i = this.panes.length; i < this.state.count; i++) {
        const pane = new Pane(i, this.state.configs[i], {
          sources: this.sources,
          symbolsFor: (k) => this.symbolsFor(k),
          addCustomSymbol: (k, s) => this.addCustomSymbol(k, s),
          onChange: (idx, cfg) => {
            this.state.configs[idx] = Object.assign({}, cfg);
            this.save();
          },
        });
        this.panes.push(pane);
        pane.mount(grid);
      }
      requestAnimationFrame(() => this.panes.forEach((p) => p.resize()));
    },

    /** Called after Settings changes which brokers are available. */
    async reloadSources() {
      let sources;
      try {
        ({ sources } = await Feeds.api.sources());
      } catch (err) {
        console.warn('[app] could not reload sources', err.message);
        return;
      }
      this.sources = {};
      sources.forEach((s) => { this.sources[s.key] = s; });
      this.normalizeConfigs();
      this.save();
      Feeds.Poller.stopAll();
      while (this.panes.length) this.panes.pop().destroy();
      this.renderGrid();
      this.paintFeedLabel();
    },

    /* ---------------------------------------------------------- status */
    paintFeedLabel() {
      const names = Object.values(this.sources).map((s) => s.key);
      document.getElementById('feed-label').textContent =
        names.includes('zerodha') ? 'Kite live' : 'yfinance';
    },

    wireStatus() {
      const pill = document.getElementById('feed-status');
      Feeds.Poller.onStatus((s) => {
        pill.dataset.state = s === 'live' ? 'live' : s === 'down' ? 'down' : '';
      });
      this.paintFeedLabel();
    },

    fatal(message) {
      const box = document.getElementById('boot-error');
      box.textContent = message;
      box.hidden = false;
    },

    /* ------------------------------------------------------------ boot */
    async start() {
      if (!global.LightweightCharts) {
        this.fatal('Could not load lightweight-charts from unpkg.com. Check the network, '
          + 'or vendor the library locally and point index.html at it.');
        return;
      }
      this.load();
      try {
        const { sources } = await Feeds.api.sources();
        if (!sources || !sources.length) throw new Error('no data sources registered');
        sources.forEach((s) => { this.sources[s.key] = s; });
      } catch (err) {
        this.fatal('Could not load data sources: ' + err.message);
        return;
      }

      this.normalizeConfigs();
      this.renderCountPicker();
      this.renderGrid();
      this.wireStatus();

      document.addEventListener('keydown', (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
        const settings = document.getElementById('settings');
        if (settings && !settings.hidden) return;
        if (global.Popover && Popover.isOpen()) return;
        const n = parseInt(e.key, 10);
        if (COUNTS.indexOf(n) !== -1) this.setCount(n);
      });

      window.addEventListener('resize', () => this.panes.forEach((p) => p.resize()));
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) this.panes.forEach((p) => p.refreshHistory());
      });
    },
  };

  global.App = App;      /* started by auth.js */
})(window);

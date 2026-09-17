/* app.js — grid layout, the chart-count selector, and persistence.
 * App.start() is called by auth.js once the viewer is allowed in. */
(function (global) {
  'use strict';

  /* A layout is more than a count now: 2 and 2v both show two charts but
   * side by side vs stacked, and 3 is one anchor plus two companions. */
  const LAYOUTS = [
    { id: '1', label: '1', n: 1 },
    { id: '2', label: '2', n: 2 },
    { id: '2v', label: '2\u2195', n: 2 },
    { id: '3', label: '3', n: 3 },
    { id: '4', label: '4', n: 4 },
    { id: '6', label: '6', n: 6 },
    { id: '8', label: '8', n: 8 },
  ];
  const LAYOUT_BY_ID = {};
  LAYOUTS.forEach((l) => { LAYOUT_BY_ID[l.id] = l; });
  const STORE_KEY = 'ltg.state.v5';
  const MAX_PANES = 8;

  const App = {
    sources: {},
    customSymbols: {},
    panes: [],
    state: { layout: '4', configs: [], syncCrosshair: false, syncSymbol: false },
    activeIndex: 0,
    maximised: null,

    /* --------------------------------------------------------- storage */
    load() {
      try {
        const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
        if (LAYOUT_BY_ID[saved.layout]) this.state.layout = saved.layout;
        else if (LAYOUT_BY_ID[String(saved.count)]) this.state.layout = String(saved.count);
        this.state.syncCrosshair = !!saved.syncCrosshair;
        this.state.syncSymbol = !!saved.syncSymbol;
        if (Array.isArray(saved.configs)) this.state.configs = saved.configs;
        if (saved.customSymbols && typeof saved.customSymbols === 'object') {
          this.customSymbols = saved.customSymbols;
        }
      } catch (_) { /* corrupt or blocked storage: defaults */ }
    },

    save() {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          layout: this.state.layout,
          configs: this.state.configs,
          customSymbols: this.customSymbols,
          syncCrosshair: this.state.syncCrosshair,
          syncSymbol: this.state.syncSymbol,
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
          indicators: [],
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
          // validated against the server catalog once it has loaded
          indicators: Array.isArray(saved.indicators) ? saved.indicators : [],
        });
      }
      this.state.configs = out;
    },

    /* ------------------------------------------------------------ grid */
    get paneCount() { return (LAYOUT_BY_ID[this.state.layout] || LAYOUTS[4]).n; },

    renderCountPicker() {
      const host = document.getElementById('count-picker');
      host.innerHTML = '';
      LAYOUTS.forEach((l) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = l.label;
        b.title = l.n + ' chart' + (l.n > 1 ? 's' : '')
          + (l.id === '2v' ? ', stacked' : l.id === '3' ? ', one large plus two' : '');
        b.setAttribute('aria-pressed', String(l.id === this.state.layout));
        b.addEventListener('click', () => this.setLayout(l.id));
        host.appendChild(b);
      });
    },

    setLayout(id) {
      if (!LAYOUT_BY_ID[id] || id === this.state.layout) return;
      this.state.layout = id;
      this.clearMaximised();
      this.save();
      this.renderCountPicker();
      this.renderGrid();
    },

    /* ------------------------------------------------ focus & maximise */
    setActive(index) {
      this.activeIndex = index;
      this.panes.forEach((p, i) => p.root.classList.toggle('active', i === index));
    },

    clearMaximised() {
      const grid = document.getElementById('grid');
      grid.classList.remove('has-max');
      this.panes.forEach((p) => p.root.classList.remove('maximised'));
      this.maximised = null;
    },

    toggleMaximise(pane) {
      const grid = document.getElementById('grid');
      if (this.maximised === pane) this.clearMaximised();
      else {
        this.clearMaximised();
        this.maximised = pane;
        grid.classList.add('has-max');
        pane.root.classList.add('maximised');
      }
      requestAnimationFrame(() => this.panes.forEach((p) => p.resize()));
    },

    /* ------------------------------------------------------ synchronise */
    toggleSync(which) {
      this.state[which] = !this.state[which];
      this.save();
      this.paintSyncButtons();
      if (which === 'syncCrosshair' && !this.state.syncCrosshair) {
        this.panes.forEach((p) => { try { p.chart.clearCrosshairPosition(); } catch (_) {} });
      }
    },

    paintSyncButtons() {
      const c = document.getElementById('sync-crosshair');
      const s2 = document.getElementById('sync-symbol');
      if (c) c.classList.toggle('on', this.state.syncCrosshair);
      if (s2) s2.classList.toggle('on', this.state.syncSymbol);
    },

    /** Broadcast one pane's crosshair time to the others. */
    broadcastCrosshair(from, time) {
      if (!this.state.syncCrosshair) return;
      this.panes.forEach((p) => {
        if (p === from || !p.chart || !p.series) return;
        p._echo = true;
        try {
          if (time == null) p.chart.clearCrosshairPosition();
          else {
            const shifted = time - from.tzShift + p.tzShift;
            const bar = p.series.dataByIndex
              ? null : null;
            p.chart.setCrosshairPosition(p.lastPrice || 0, shifted, p.series);
          }
        } catch (_) {}
        p._echo = false;
      });
    },

    /** Load a symbol into the active pane, or all panes when symbol sync is on. */
    loadSymbol(symbol) {
      if (!symbol) return;
      const targets = this.state.syncSymbol
        ? this.panes
        : [this.panes[this.activeIndex] || this.panes[0]];
      targets.forEach((p) => {
        if (!p) return;
        if (!this.symbolsFor(p.source.key).some((s) => s.symbol === symbol)) {
          this.addCustomSymbol(p.source.key, symbol);
        }
        p.apply({ symbol: symbol });
      });
    },

    renderGrid() {
      const grid = document.getElementById('grid');
      grid.dataset.layout = this.state.layout;
      const count = this.paneCount;
      while (this.panes.length > count) this.panes.pop().destroy();
      for (let i = this.panes.length; i < count; i++) {
        const pane = new Pane(i, this.state.configs[i], {
          sources: this.sources,
          symbolsFor: (k) => this.symbolsFor(k),
          addCustomSymbol: (k, s) => this.addCustomSymbol(k, s),
          onChange: (idx, cfg) => {
            this.state.configs[idx] = Object.assign({}, cfg);
            this.save();
            if (this.state.syncSymbol && !this._syncing) {
              this._syncing = true;
              this.panes.forEach((p, i) => { if (i !== idx) p.apply({ symbol: cfg.symbol }); });
              this._syncing = false;
            }
          },
          onFocus: (idx) => this.setActive(idx),
          onMaximise: (pane) => this.toggleMaximise(pane),
          onCrosshair: (pane, time) => this.broadcastCrosshair(pane, time),
        });
        this.panes.push(pane);
        pane.mount(grid);
      }
      this.setActive(Math.min(this.activeIndex, this.panes.length - 1));
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

      try { await Indicators.load(); } catch (_) { /* menu will retry on open */ }
      this.state.configs.forEach((c) => { c.indicators = Indicators.clean(c.indicators); });
      this.normalizeConfigs();
      this.renderCountPicker();
      this.renderGrid();
      this.wireStatus();
      Watchlist.wire();
      this.paintSyncButtons();
      document.getElementById('sync-crosshair')
        .addEventListener('click', () => this.toggleSync('syncCrosshair'));
      document.getElementById('sync-symbol')
        .addEventListener('click', () => this.toggleSync('syncSymbol'));

      document.addEventListener('keydown', (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
        const settings = document.getElementById('settings');
        if (settings && !settings.hidden) return;
        if (global.Popover && Popover.isOpen()) return;
        if (e.key.toLowerCase() === 'f' && this.panes[this.activeIndex]) {
          this.toggleMaximise(this.panes[this.activeIndex]);
          return;
        }
        if (LAYOUT_BY_ID[e.key]) this.setLayout(e.key);
      });

      window.addEventListener('resize', () => this.panes.forEach((p) => p.resize()));
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) this.panes.forEach((p) => p.refreshHistory(true));
      });
    },
  };

  global.App = App;      /* started by auth.js */
})(window);

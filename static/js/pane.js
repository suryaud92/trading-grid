/* pane.js — one chart pane: header dropdowns + flashing ticker + candles. */
(function (global) {
  'use strict';

  const TF_SECONDS = {
    '1m': 60, '2m': 120, '5m': 300, '15m': 900, '30m': 1800,
    '1h': 3600, '2h': 7200, '4h': 14400, '1d': 86400, '1w': 604800,
  };

  const LWC = global.LightweightCharts;

  /* v4 (addCandlestickSeries) and v5 (addSeries + CandlestickSeries) both work */
  function addCandles(chart, options) {
    if (typeof chart.addCandlestickSeries === 'function') return chart.addCandlestickSeries(options);
    if (typeof chart.addSeries === 'function' && LWC.CandlestickSeries) {
      return chart.addSeries(LWC.CandlestickSeries, options);
    }
    throw new Error('Unsupported lightweight-charts build');
  }

  function decimalsFor(price) {
    const p = Math.abs(price || 0);
    if (p >= 1000) return 2;
    if (p >= 10) return 2;
    if (p >= 1) return 4;
    if (p >= 0.01) return 5;
    return 7;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  class Pane {
    constructor(index, config, ctx) {
      this.index = index;
      this.config = Object.assign({}, config);
      this.ctx = ctx;                 // {sources: {...}, onChange(index, config)}
      this.unsubLive = null;
      this.refreshTimer = null;
      this.lastPrice = null;
      this.refPrice = null;
      this.lastBar = null;
      this.decimals = 2;
      this.reqToken = 0;
      this.build();
    }

    get source() { return this.ctx.sources[this.config.source] || Object.values(this.ctx.sources)[0]; }
    get tfSeconds() { return TF_SECONDS[this.config.timeframe] || 60; }
    get tzShift() { return (this.source.tzOffsetMin || 0) * 60; }

    /* ------------------------------------------------------------ DOM */
    build() {
      const root = el('section', 'pane');
      root.dataset.index = String(this.index);

      /* header */
      const head = el('div', 'pane-head');
      head.appendChild(el('span', 'pane-idx', String(this.index + 1)));

      this.selSymbol = el('select', 'sel-symbol');
      this.selSymbol.title = 'Symbol';
      this.selTf = el('select', 'sel-tf');
      this.selTf.title = 'Timeframe';
      this.selSource = el('select', 'sel-source');
      this.selSource.title = 'Data source';

      head.append(this.selSymbol, this.selTf, this.selSource);

      /* ticker */
      this.ticker = el('div', 'ticker');
      this.tSym = el('span', 't-sym', '—');
      this.tChg = el('span', 't-chg', '—');
      this.tPrice = el('span', 't-price', '—');
      this.tChg.title = 'Change vs. the first bar in this window';
      this.ticker.append(this.tSym, this.tChg, this.tPrice);

      /* chart */
      const body = el('div', 'pane-body');
      this.chartEl = el('div', 'chart');
      this.msgEl = el('div', 'pane-msg', 'Loading…');
      body.append(this.chartEl, this.msgEl);

      root.append(head, this.ticker, body);
      this.root = root;

      this.fillSources();
      this.fillTimeframes();
      this.fillSymbols();

      this.selSource.addEventListener('change', () => {
        const src = this.ctx.sources[this.selSource.value];
        this.apply({ source: src.key, symbol: src.defaultSymbol, timeframe: src.defaultTimeframe });
      });
      this.selTf.addEventListener('change', () => this.apply({ timeframe: this.selTf.value }));
      this.selSymbol.addEventListener('change', () => {
        if (this.selSymbol.value === '__custom__') {
          const typed = (prompt('Symbol (exactly as the source expects it, e.g. TATAPOWER.NS or ARB):', '') || '').trim();
          this.selSymbol.value = this.config.symbol;
          if (!typed) return;
          const sym = typed.toUpperCase();
          this.ctx.addCustomSymbol(this.source.key, sym);
          this.fillSymbols();
          this.apply({ symbol: sym });
          return;
        }
        this.apply({ symbol: this.selSymbol.value });
      });
    }

    fillSources() {
      this.selSource.innerHTML = '';
      Object.values(this.ctx.sources).forEach((s) => {
        const o = el('option', null, s.label);
        o.value = s.key;
        this.selSource.appendChild(o);
      });
      this.selSource.value = this.source.key;
    }

    fillTimeframes() {
      const tfs = this.source.timeframes;
      this.selTf.innerHTML = '';
      tfs.forEach((tf) => {
        const o = el('option', null, tf.label);
        o.value = tf.id;
        this.selTf.appendChild(o);
      });
      if (!tfs.some((tf) => tf.id === this.config.timeframe)) {
        this.config.timeframe = this.source.defaultTimeframe;
      }
      this.selTf.value = this.config.timeframe;
    }

    fillSymbols() {
      const src = this.source;
      const list = this.ctx.symbolsFor(src.key).slice();
      if (!list.some((s) => s.symbol === this.config.symbol)) {
        list.unshift({ symbol: this.config.symbol, label: this.config.symbol });
      }
      this.selSymbol.innerHTML = '';
      list.forEach((s) => {
        const o = el('option', null, s.label || s.symbol);
        o.value = s.symbol;
        this.selSymbol.appendChild(o);
      });
      const custom = el('option', null, '＋ Custom symbol…');
      custom.value = '__custom__';
      this.selSymbol.appendChild(custom);
      this.selSymbol.value = this.config.symbol;
    }

    /* ---------------------------------------------------------- chart */
    mount(parent) {
      parent.appendChild(this.root);
      this.createChart();
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(this.chartEl);
      this.reload();
    }

    createChart() {
      this.chart = LWC.createChart(this.chartEl, {
        layout: {
          background: { type: 'solid', color: '#121722' },
          textColor: '#8b97ab',
          fontSize: 10,
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: 'rgba(34,43,58,.55)' },
          horzLines: { color: 'rgba(34,43,58,.55)' },
        },
        rightPriceScale: { borderColor: '#222b3a', scaleMargins: { top: 0.12, bottom: 0.12 } },
        timeScale: { borderColor: '#222b3a', timeVisible: true, secondsVisible: false, rightOffset: 4 },
        crosshair: {
          mode: 0,
          vertLine: { color: '#4f8cff', width: 1, style: 3, labelBackgroundColor: '#4f8cff' },
          horzLine: { color: '#4f8cff', width: 1, style: 3, labelBackgroundColor: '#4f8cff' },
        },
        handleScale: { axisPressedMouseMove: { time: true, price: false } },
        autoSize: false,
        width: this.chartEl.clientWidth || 300,
        height: this.chartEl.clientHeight || 200,
      });

      this.series = addCandles(this.chart, {
        upColor: '#22c55e', downColor: '#ef4444',
        borderUpColor: '#22c55e', borderDownColor: '#ef4444',
        wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      });
    }

    resize() {
      if (!this.chart) return;
      const w = this.chartEl.clientWidth, h = this.chartEl.clientHeight;
      if (w > 0 && h > 0) this.chart.resize(w, h);
    }

    /* --------------------------------------------------------- config */
    apply(patch) {
      const before = JSON.stringify(this.config);
      Object.assign(this.config, patch);
      if (patch.source) { this.fillTimeframes(); this.fillSymbols(); }
      this.selSource.value = this.config.source;
      this.selTf.value = this.config.timeframe;
      this.selSymbol.value = this.config.symbol;
      if (JSON.stringify(this.config) === before) return;
      this.ctx.onChange(this.index, this.config);
      this.reload();
    }

    message(text, isError) {
      this.msgEl.textContent = text || '';
      this.msgEl.classList.toggle('error', !!isError);
      this.msgEl.hidden = !text;
    }

    /* ----------------------------------------------------- data cycle */
    async reload() {
      const token = ++this.reqToken;
      this.stopLive();
      this.lastPrice = null;
      this.refPrice = null;
      this.lastBar = null;
      this.tSym.textContent = this.config.symbol;
      this.tPrice.textContent = '—';
      this.tChg.textContent = '—';
      this.tChg.removeAttribute('data-dir');
      this.ticker.classList.remove('up', 'down');
      this.message('Loading ' + this.config.symbol + '…');

      try {
        const res = await Feeds.api.candles(
          this.config.source, this.config.symbol, this.config.timeframe, 600
        );
        if (token !== this.reqToken) return;
        const candles = res.candles || [];
        if (!candles.length) throw new Error('no candles returned');

        this.decimals = decimalsFor(candles[candles.length - 1].close);
        this.series.applyOptions({
          priceFormat: { type: 'price', precision: this.decimals, minMove: Math.pow(10, -this.decimals) },
        });

        const shift = this.tzShift;
        this.series.setData(candles.map((c) => ({
          time: c.time + shift,
          open: c.open, high: c.high, low: c.low, close: c.close,
        })));
        this.chart.timeScale().fitContent();

        this.lastBar = Object.assign({}, candles[candles.length - 1]);
        this.refPrice = candles[0].open;
        this.message('');
        this.setPrice(this.lastBar.close, true);
        this.startLive();
      } catch (err) {
        if (token !== this.reqToken) return;
        console.warn('[pane ' + this.index + ']', err);
        this.message(this.config.symbol + ' — ' + err.message, true);
      }
    }

    startLive() {
      const src = this.source;
      this.unsubLive = Feeds.subscribe(src, this.config.symbol, this.config.timeframe, {
        onCandle: (c) => this.onCandle(c),
        onPrice: (q) => this.onPrice(q),
      });

      const refreshMs = src.stream.refresh_ms;
      if (refreshMs) {
        this.refreshTimer = setInterval(() => {
          if (!document.hidden) this.refreshHistory();
        }, refreshMs);
      }
    }

    stopLive() {
      if (this.unsubLive) { this.unsubLive(); this.unsubLive = null; }
      if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    }

    /** Quiet re-pull of bars for polled sources (keeps OHLC honest). */
    async refreshHistory() {
      const token = this.reqToken;
      try {
        const res = await Feeds.api.candles(
          this.config.source, this.config.symbol, this.config.timeframe, 600
        );
        if (token !== this.reqToken || !res.candles || !res.candles.length) return;
        const shift = this.tzShift;
        this.series.setData(res.candles.map((c) => ({
          time: c.time + shift,
          open: c.open, high: c.high, low: c.low, close: c.close,
        })));
        this.lastBar = Object.assign({}, res.candles[res.candles.length - 1]);
      } catch (_) { /* a failed refresh is not worth disturbing the pane */ }
    }

    /* Real bar from a websocket feed. */
    onCandle(c) {
      if (!this.series) return;
      this.series.update({
        time: c.time + this.tzShift,
        open: c.open, high: c.high, low: c.low, close: c.close,
      });
      this.lastBar = { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close };
      this.setPrice(c.close);
    }

    /* Bare tick — fold it into the bar we're standing on. */
    onPrice(q) {
      const price = q.price;
      const now = q.time || Math.floor(Date.now() / 1000);
      if (this.series && this.lastBar) {
        const tf = this.tfSeconds;
        const bucket = Math.floor(now / tf) * tf;
        if (bucket > this.lastBar.time) {
          this.lastBar = { time: bucket, open: price, high: price, low: price, close: price };
        } else {
          this.lastBar.close = price;
          this.lastBar.high = Math.max(this.lastBar.high, price);
          this.lastBar.low = Math.min(this.lastBar.low, price);
        }
        const b = this.lastBar;
        this.series.update({
          time: b.time + this.tzShift,
          open: b.open, high: b.high, low: b.low, close: b.close,
        });
      }
      this.setPrice(price);
    }

    /* ------------------------------------------------- the ticker bar */
    setPrice(price, silent) {
      if (typeof price !== 'number' || !isFinite(price)) return;
      const prev = this.lastPrice;
      this.lastPrice = price;
      if (this.refPrice == null) this.refPrice = price;

      this.tPrice.textContent = price.toLocaleString(undefined, {
        minimumFractionDigits: this.decimals,
        maximumFractionDigits: this.decimals,
      });

      const diff = price - this.refPrice;
      const pct = this.refPrice ? (diff / this.refPrice) * 100 : 0;
      const sign = diff > 0 ? '+' : '';
      this.tChg.textContent = sign + diff.toFixed(this.decimals) + '  ' + sign + pct.toFixed(2) + '%';
      this.tChg.dataset.dir = diff > 0 ? 'up' : diff < 0 ? 'down' : '';

      if (silent || prev == null || price === prev) return;

      const dir = price > prev ? 'up' : 'down';
      this.ticker.classList.remove('up', 'down', 'flash-up', 'flash-down');
      void this.ticker.offsetWidth;                 // restart the CSS animation
      this.ticker.classList.add(dir, 'flash-' + dir);
      clearTimeout(this._flashTimer);
      this._flashTimer = setTimeout(() => {
        this.ticker.classList.remove('flash-up', 'flash-down');
      }, 520);
    }

    /* -------------------------------------------------------- teardown */
    destroy() {
      this.reqToken++;
      this.stopLive();
      clearTimeout(this._flashTimer);
      if (this.observer) this.observer.disconnect();
      if (this.chart) { try { this.chart.remove(); } catch (_) {} this.chart = null; }
      if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    }
  }

  global.Pane = Pane;
})(window);

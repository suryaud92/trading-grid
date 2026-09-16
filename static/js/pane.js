/* pane.js — one chart pane: symbol search, timeframe, indicators, alerts,
 * flashing ticker, candles. */
(function (global) {
  'use strict';

  const TF_SECONDS = {
    '1m': 60, '2m': 120, '3m': 180, '5m': 300, '10m': 600, '15m': 900,
    '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '1d': 86400,
  };
  /* Weeks and months have no fixed length, so live ticks fold into the
   * current bar and the periodic history refresh starts the next one. */
  const LONG_TF = { '1w': true, '1M': true };

  const LWC = global.LightweightCharts;

  function addCandles(chart, options) {
    if (typeof chart.addCandlestickSeries === 'function') return chart.addCandlestickSeries(options);
    if (typeof chart.addSeries === 'function' && LWC.CandlestickSeries) {
      return chart.addSeries(LWC.CandlestickSeries, options);
    }
    throw new Error('Unsupported lightweight-charts build');
  }

  function addLine(chart, options) {
    if (typeof chart.addLineSeries === 'function') return chart.addLineSeries(options);
    if (typeof chart.addSeries === 'function' && LWC.LineSeries) {
      return chart.addSeries(LWC.LineSeries, options);
    }
    throw new Error('Unsupported lightweight-charts build');
  }

  function decimalsFor(price) {
    const p = Math.abs(price || 0);
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
      this.config = Object.assign({ indicators: [] }, config);
      this.config.indicators = Array.isArray(this.config.indicators)
        ? this.config.indicators.slice() : [];
      this.ctx = ctx;
      this.unsubLive = null;
      this.refreshTimer = null;
      this.lastPrice = null;
      this.refPrice = null;
      this.lastBar = null;
      this.candles = [];
      this.indSeries = new Map();
      this.indLines = new Map();   // key -> [{time,value}] merged history
      this.decimals = 2;
      this.reqToken = 0;
      this.build();
    }

    get source() { return this.ctx.sources[this.config.source] || Object.values(this.ctx.sources)[0]; }
    get tfSeconds() { return TF_SECONDS[this.config.timeframe] || 60; }
    get isLongTf() { return !!LONG_TF[this.config.timeframe]; }
    get tzShift() { return (this.source.tzOffsetMin || 0) * 60; }
    get symbolLabel() {
      const hit = this.ctx.symbolsFor(this.source.key).find((s) => s.symbol === this.config.symbol);
      return (hit && hit.label) || this.config.symbol;
    }

    /* ------------------------------------------------------------ DOM */
    build() {
      const root = el('section', 'pane');
      root.dataset.index = String(this.index);

      const head = el('div', 'pane-head');
      head.appendChild(el('span', 'pane-idx', String(this.index + 1)));

      this.symbolInput = el('input', 'sel-symbol');
      this.symbolInput.type = 'text';
      this.symbolInput.title = 'Type to search symbols';
      this.symbolInput.value = this.config.symbol;

      this.selTf = el('select', 'sel-tf');
      this.selTf.title = 'Timeframe';
      this.selSource = el('select', 'sel-source');
      this.selSource.title = 'Data source';

      this.btnInd = el('button', 'pane-btn', 'ƒx');
      this.btnInd.type = 'button';
      this.btnInd.title = 'Indicators';
      this.btnAlert = el('button', 'pane-btn', '🔔');
      this.btnAlert.type = 'button';
      this.btnAlert.title = 'Price alerts';

      head.append(this.symbolInput, this.selTf, this.selSource, this.btnInd, this.btnAlert);

      this.ticker = el('div', 'ticker');
      this.tSym = el('span', 't-sym', '—');
      this.tChg = el('span', 't-chg', '—');
      this.tPrice = el('span', 't-price', '—');
      this.tChg.title = 'Change';
      this.ticker.append(this.tSym, this.tChg, this.tPrice);

      const body = el('div', 'pane-body');
      this.chartEl = el('div', 'chart');
      this.msgEl = el('div', 'pane-msg', 'Loading…');
      body.append(this.chartEl, this.msgEl);

      root.append(head, this.ticker, body);
      this.root = root;

      this.fillSources();
      this.fillTimeframes();

      Combobox.attach(this.symbolInput, {
        items: () => this.ctx.symbolsFor(this.source.key),
        current: () => this.config.symbol,
        onPick: (symbol) => {
          if (!this.ctx.symbolsFor(this.source.key).some((s) => s.symbol === symbol)) {
            this.ctx.addCustomSymbol(this.source.key, symbol);
          }
          this.apply({ symbol: symbol });
        },
      });

      this.selSource.addEventListener('change', () => {
        const src = this.ctx.sources[this.selSource.value];
        this.apply({ source: src.key, symbol: src.defaultSymbol, timeframe: src.defaultTimeframe });
      });
      this.selTf.addEventListener('change', () => this.apply({ timeframe: this.selTf.value }));
      this.btnInd.addEventListener('click', () => this.openIndicatorMenu());
      this.btnAlert.addEventListener('click', () => this.openAlertMenu());

      this.offAlerts = Alerts.onChange(() => this.paintAlertBadge());
      this.paintAlertBadge();
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

    fillSymbols() { this.symbolInput.value = this.config.symbol; }

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
          textColor: '#8b97ab', fontSize: 10, attributionLogo: false,
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
      if (patch.source) { this.fillTimeframes(); }
      this.selSource.value = this.config.source;
      this.selTf.value = this.config.timeframe;
      this.symbolInput.value = this.config.symbol;
      if (JSON.stringify(this.config) === before) return;
      this.paintAlertBadge();
      this.ctx.onChange(this.index, this.config);
      if (patch.indicators) { this.applyIndicators(); return; }
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
      this.candles = [];
      this.tSym.textContent = this.config.symbol;
      this.tPrice.textContent = '—';
      this.tChg.textContent = '—';
      this.tChg.removeAttribute('data-dir');
      this.ticker.classList.remove('up', 'down');
      this.message('Loading ' + this.config.symbol + '…');

      try {
        const res = await Feeds.api.candles(
          this.config.source, this.config.symbol, this.config.timeframe, 600,
          Indicators.spec(this.config.indicators)
        );
        if (token !== this.reqToken) return;
        const candles = res.candles || [];
        if (!candles.length) throw new Error('no candles returned');

        this.candles = candles;
        this.decimals = decimalsFor(candles[candles.length - 1].close);
        this.series.applyOptions({
          priceFormat: { type: 'price', precision: this.decimals, minMove: Math.pow(10, -this.decimals) },
        });
        this.series.setData(this.chartData());
        this.indLines = new Map((res.indicators || []).map((l) => [l.key, l]));
        this.drawIndicators();
        this.chart.timeScale().fitContent();

        this.lastBar = Object.assign({}, candles[candles.length - 1]);
        this.refPrice = this.computeReference(candles);
        this.tChg.title = this.referenceLabel();
        this.message('');
        this.setPrice(this.lastBar.close, true);
        this.startLive();
      } catch (err) {
        if (token !== this.reqToken) return;
        console.warn('[pane ' + this.index + ']', err);
        this.message(this.config.symbol + ' — ' + err.message, true);
      }
    }

    /* What the ticker's change is measured against.
     *
     * Using the first bar in the window worked while a day was the longest
     * timeframe, but on a monthly chart that reaches back to the 1990s and
     * the percentage becomes meaningless. So: intraday compares with the
     * previous session's close ("change today"), and daily and longer compare
     * with the previous bar's close ("change this day/week/month"). */
    computeReference(candles) {
      if (!candles || !candles.length) return null;
      if (candles.length < 2) return candles[0].open;

      const tf = this.config.timeframe;
      if (tf === '1d' || this.isLongTf) return candles[candles.length - 2].close;

      const shift = this.tzShift;
      const dayOf = (c) => Math.floor((c.time + shift) / 86400);
      const today = dayOf(candles[candles.length - 1]);
      for (let i = candles.length - 2; i >= 0; i--) {
        if (dayOf(candles[i]) !== today) return candles[i].close;
      }
      return candles[0].open;
    }

    referenceLabel() {
      const tf = this.config.timeframe;
      if (tf === '1M') return 'Change this month';
      if (tf === '1w') return 'Change this week';
      if (tf === '1d') return 'Change since the previous daily close';
      return 'Change today (vs the previous session close)';
    }

    chartData() {
      const shift = this.tzShift;
      return this.candles.map((c) => ({
        time: c.time + shift,
        open: c.open, high: c.high, low: c.low, close: c.close,
      }));
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
          if (!document.hidden) this.refreshHistory(false);
        }, refreshMs);
      }
    }

    stopLive() {
      if (this.unsubLive) { this.unsubLive(); this.unsubLive = null; }
      if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    }

    /* Periodic top-up.
     *
     * Only the newest bar or two actually change, so the routine refresh asks
     * for a handful of candles and merges them in. Re-pulling the full 600
     * every minute cost ~65 KB per pane per minute, which on eight panes is
     * about 4 GB a month — enough to blow a free host's bandwidth allowance
     * for the sake of data we already had. `full` forces a complete re-pull,
     * used when the tab comes back into view. */
    async refreshHistory(full) {
      const token = this.reqToken;
      try {
        const res = await Feeds.api.candles(
          this.config.source, this.config.symbol, this.config.timeframe, full ? 600 : 3,
          Indicators.spec(this.config.indicators)
        );
        if (token !== this.reqToken || !res.candles || !res.candles.length) return;

        if (full) {
          this.candles = res.candles;
        } else {
          const byTime = new Map(this.candles.map((c) => [c.time, c]));
          res.candles.forEach((c) => byTime.set(c.time, c));   // newer bar wins
          this.candles = Array.from(byTime.values())
            .sort((a, b) => a.time - b.time)
            .slice(-1500);
        }

        this.series.setData(this.chartData());
        this.mergeIndicators(res.indicators || [], full);
        this.drawIndicators();
        const last = this.candles[this.candles.length - 1];
        this.lastBar = Object.assign({}, last);
        this.refPrice = this.computeReference(this.candles);
      } catch (_) { /* a failed refresh should not disturb the pane */ }
    }

    onCandle(c) {
      if (!this.series) return;
      this.series.update({
        time: c.time + this.tzShift,
        open: c.open, high: c.high, low: c.low, close: c.close,
      });
      const last = this.candles[this.candles.length - 1];
      if (last && last.time === c.time) this.candles[this.candles.length - 1] = c;
      else this.candles.push(c);
      this.setPrice(c.close);
    }

    onPrice(q) {
      const price = q.price;
      const now = q.time || Math.floor(Date.now() / 1000);
      if (this.series && this.lastBar) {
        const b = this.lastBar;
        const tf = this.tfSeconds;
        const bucket = Math.floor(now / tf) * tf;
        if (!this.isLongTf && bucket > b.time) {
          this.lastBar = { time: bucket, open: price, high: price, low: price, close: price, volume: 0 };
          this.candles.push(this.lastBar);
        } else {
          b.close = price;
          b.high = Math.max(b.high, price);
          b.low = Math.min(b.low, price);
          const last = this.candles[this.candles.length - 1];
          if (last && last.time === b.time) Object.assign(last, b);
        }
        const bar = this.lastBar;
        this.series.update({
          time: bar.time + this.tzShift,
          open: bar.open, high: bar.high, low: bar.low, close: bar.close,
        });
      }
      this.setPrice(price);
    }

    /* ---------------------------------------------------- indicators */

    /** Fold a top-up response into the series we already hold. */
    mergeIndicators(lines, full) {
      if (full) {
        this.indLines = new Map(lines.map((l) => [l.key, l]));
        return;
      }
      const seen = new Set();
      lines.forEach((l) => {
        seen.add(l.key);
        const existing = this.indLines.get(l.key);
        if (!existing) { this.indLines.set(l.key, l); return; }
        const byTime = new Map(existing.data.map((p) => [p.time, p]));
        l.data.forEach((p) => byTime.set(p.time, p));
        existing.data = Array.from(byTime.values())
          .sort((a, b) => a.time - b.time)
          .slice(-1500);
        Object.assign(existing, { color: l.color, style: l.style, width: l.width,
                                  pane: l.pane, guides: l.guides, name: l.name });
      });
      Array.from(this.indLines.keys()).forEach((k) => {
        if (!seen.has(k)) this.indLines.delete(k);
      });
    }

    drawIndicators() {
      if (!this.chart) return;
      const shift = this.tzShift;
      const wanted = this.indLines;

      for (const [key, series] of this.indSeries) {
        if (!wanted.has(key)) {
          try { this.chart.removeSeries(series); } catch (_) {}
          this.indSeries.delete(key);
        }
      }

      /* Each band indicator gets its own price scale and its own horizontal
       * slice at the bottom, because their ranges are nothing alike — RSI is
       * 0-100, OBV runs to millions. Sharing a scale would flatten both. */
      const bandGroups = [];
      for (const line of wanted.values()) {
        if (line.pane === 'sub' && bandGroups.indexOf(line.group) === -1) {
          bandGroups.push(line.group);
        }
      }
      const n = bandGroups.length;
      const bandH = n ? Math.min(0.22, 0.62 / n) : 0;
      const scaleFor = (group) => 'sub' + bandGroups.indexOf(group);
      const marginsFor = (i) => ({ top: 1 - (n - i) * bandH, bottom: (n - 1 - i) * bandH });

      for (const [key, line] of wanted) {
        const isSub = line.pane === 'sub';
        const scaleId = isSub ? scaleFor(line.group) : 'right';
        let series = this.indSeries.get(key);

        if (series && series.__scaleId !== scaleId) {
          try { this.chart.removeSeries(series); } catch (_) {}
          this.indSeries.delete(key);
          series = null;
        }
        if (!series) {
          series = addLine(this.chart, {
            color: line.color,
            lineWidth: line.width || 2,
            lineStyle: line.style === 'dashed' ? 2 : 0,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            priceScaleId: scaleId,
          });
          series.__scaleId = scaleId;
          if (isSub) {
            (line.guides || []).forEach((lvl) => series.createPriceLine({
              price: lvl, color: 'rgba(139,151,171,.35)', lineWidth: 1,
              lineStyle: 2, axisLabelVisible: false,
            }));
          }
          this.indSeries.set(key, series);
        }
        series.setData((line.data || []).map((p) => ({ time: p.time + shift, value: p.value })));
      }

      bandGroups.forEach((g, i) => {
        this.chart.priceScale('sub' + i).applyOptions({ scaleMargins: marginsFor(i) });
      });
      this.chart.priceScale('right').applyOptions({
        scaleMargins: { top: 0.12, bottom: n ? n * bandH + 0.02 : 0.12 },
      });
      this.btnInd.classList.toggle('on', this.config.indicators.length > 0);
    }

    setIndicators(list) {
      this.config.indicators = Indicators.clean(list);
      this.ctx.onChange(this.index, this.config);
      this.btnInd.classList.toggle('on', this.config.indicators.length > 0);
      this.refreshHistory(true);
    }

    async openIndicatorMenu() {
      await Indicators.load();
      Popover.open(this.btnInd, (host, close) => {
        const draw = () => {
          host.innerHTML = '';
          const list = this.config.indicators;

          host.appendChild(el('div', 'pop-title', 'Indicators'));
          if (!list.length) {
            host.appendChild(el('div', 'pop-empty', 'None yet — add one below.'));
          }

          list.forEach((entry, i) => {
            const spec = Indicators.byId[entry.id];
            const row = el('div', 'pop-active');
            const dot = el('span', 'pop-swatch');
            dot.style.background = spec.lines[0].color;
            const name = el('span', 'pop-name', spec.label);

            const fields = el('span', 'pop-fields');
            spec.params.forEach((pmeta, pi) => {
              const n = el('input', 'pop-num');
              n.type = 'number';
              n.step = 'any';
              n.min = String(pmeta.min);
              n.max = String(pmeta.max);
              n.title = pmeta.name;
              n.value = String(entry.params[pi] != null ? entry.params[pi] : pmeta.default);
              n.addEventListener('change', () => {
                const v = Math.min(Math.max(Number(n.value) || pmeta.default, pmeta.min), pmeta.max);
                n.value = String(v);
                entry.params[pi] = v;
                this.setIndicators(list);
              });
              fields.appendChild(n);
            });

            const del = el('button', 'pop-x', '✕');
            del.type = 'button';
            del.title = 'Remove';
            del.addEventListener('click', () => {
              list.splice(i, 1);
              this.setIndicators(list);
              draw();
            });
            row.append(dot, name, fields, del);
            host.appendChild(row);
            if (spec.note) host.appendChild(el('div', 'pop-note tight', spec.note));
          });

          host.appendChild(el('div', 'pop-title', 'Add'));

          const search = el('input', 'pop-search');
          search.type = 'search';
          search.placeholder = 'Filter ' + Indicators.catalog.length + ' indicators…';
          host.appendChild(search);

          const groups = el('div');
          host.appendChild(groups);

          const bandsUsed = Indicators.bandCount(list);
          const renderChips = (q) => {
            groups.innerHTML = '';
            const needle = (q || '').trim().toLowerCase();
            [['price', 'On the chart'], ['sub', 'In a band below']].forEach(([kind, heading]) => {
              const matches = Indicators.catalog.filter((c) =>
                c.pane === kind &&
                (!needle || c.label.toLowerCase().includes(needle) || c.id.includes(needle)));
              if (!matches.length) return;
              const full = kind === 'sub' && bandsUsed >= Indicators.MAX_BANDS;
              groups.appendChild(el('div', 'pop-sub',
                heading + (full ? ' — ' + Indicators.MAX_BANDS + ' is the limit' : '')));
              const row = el('div', 'pop-chips');
              matches.forEach((c) => {
                const chip = el('button', 'pop-chip', c.label);
                chip.type = 'button';
                chip.disabled = full;
                chip.title = c.note || ('Add ' + c.label);
                chip.addEventListener('click', () => {
                  this.setIndicators(list.concat([{ id: c.id, params: Indicators.defaults(c.id) }]));
                  draw();
                });
                row.appendChild(chip);
              });
              groups.appendChild(row);
            });
            if (!groups.children.length) {
              groups.appendChild(el('div', 'pop-empty', 'Nothing matches "' + q + '".'));
            }
          };
          renderChips('');
          search.addEventListener('input', () => renderChips(search.value));

          host.appendChild(el('div', 'pop-note',
            'Bands stack, up to ' + Indicators.MAX_BANDS + '. Values come from pandas-ta on the server and '
            + 'update with the candle refresh, not on every tick.'));
        };
        draw();
      });
    }

    /* -------------------------------------------------------- alerts */
    paintAlertBadge() {
      if (!this.btnAlert) return;
      const mine = Alerts.forSymbol(this.config.source, this.config.symbol);
      const live = mine.filter((a) => !a.triggered).length;
      const hit = mine.some((a) => a.triggered);
      this.btnAlert.classList.toggle('on', live > 0);
      this.btnAlert.classList.toggle('hit', hit);
      this.btnAlert.dataset.count = live > 0 ? String(live) : '';
    }

    openAlertMenu() {
      Popover.open(this.btnAlert, (host, close) => {
        const draw = () => {
          host.innerHTML = '';
          host.appendChild(el('div', 'pop-title', 'Alerts · ' + this.config.symbol));

          const mine = Alerts.forSymbol(this.config.source, this.config.symbol);
          if (!mine.length) {
            host.appendChild(el('div', 'pop-empty', 'No alerts on this symbol yet.'));
          }
          mine.forEach((a) => {
            const row = el('div', 'pop-alert' + (a.triggered ? ' done' : ''));
            const txt = el('span', null,
              (a.dir === 'above' ? '↑ above ' : '↓ below ') + a.price);
            const state = el('span', 'pop-state',
              a.triggered ? 'triggered at ' + a.triggeredPrice
                : a.armed ? 'watching' : 'waiting to re-arm');
            const del = el('button', 'pop-x', '✕');
            del.type = 'button';
            del.title = 'Delete';
            del.addEventListener('click', () => { Alerts.remove(a.id); draw(); });
            row.append(txt, state, del);
            host.appendChild(row);
          });

          const form = el('div', 'pop-addalert');
          const dir = el('select', 'pop-dir');
          [['above', 'Above'], ['below', 'Below']].forEach(([v, l]) => {
            const o = el('option', null, l);
            o.value = v;
            dir.appendChild(o);
          });
          const price = el('input', 'pop-num wide');
          price.type = 'number';
          price.step = 'any';
          price.placeholder = this.lastPrice != null ? String(this.lastPrice.toFixed(this.decimals)) : 'price';
          const add = el('button', 'btn small primary', 'Add');
          add.type = 'button';
          const addIt = () => {
            const v = Number(price.value);
            if (!isFinite(v) || !price.value) return;
            Alerts.add(this.config.source, this.config.symbol, dir.value, v, this.lastPrice);
            price.value = '';
            draw();
          };
          add.addEventListener('click', addIt);
          price.addEventListener('keydown', (e) => { if (e.key === 'Enter') addIt(); });
          form.append(dir, price, add);
          host.appendChild(form);

          host.appendChild(el('div', 'pop-note',
            'Alerts are checked in this browser, so they only fire while the dashboard is open.'));
        };
        draw();
      });
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

      Alerts.check(this.config.source, this.config.symbol, price, this.symbolLabel);

      if (silent || prev == null || price === prev) return;

      const dir = price > prev ? 'up' : 'down';
      this.ticker.classList.remove('up', 'down', 'flash-up', 'flash-down');
      void this.ticker.offsetWidth;
      this.ticker.classList.add(dir, 'flash-' + dir);
      clearTimeout(this._flashTimer);
      this._flashTimer = setTimeout(() => {
        this.ticker.classList.remove('flash-up', 'flash-down');
      }, 520);
    }

    /* ------------------------------------------------------- teardown */
    destroy() {
      this.reqToken++;
      this.stopLive();
      clearTimeout(this._flashTimer);
      if (this.offAlerts) this.offAlerts();
      if (this.observer) this.observer.disconnect();
      if (this.chart) { try { this.chart.remove(); } catch (_) {} this.chart = null; }
      this.indSeries.clear();
      if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    }
  }

  global.Pane = Pane;
})(window);

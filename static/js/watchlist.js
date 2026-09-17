/* watchlist.js — categorised symbol lists in a side drawer.
 *
 * Clicking an entry loads it into the ACTIVE pane (the one you last touched),
 * or into every pane when symbol sync is on. Lists are per browser, seeded
 * with sensible defaults and editable.
 */
(function (global) {
  'use strict';

  const KEY = 'ltg.watchlists.v1';

  const DEFAULTS = [
    {
      name: 'Indian',
      items: [
        { symbol: '^NSEI', name: 'NIFTY 50' },
        { symbol: '^NSEBANK', name: 'NIFTY BANK' },
        { symbol: '^BSESN', name: 'SENSEX' },
        { symbol: 'RELIANCE.NS', name: 'Reliance' },
        { symbol: 'TCS.NS', name: 'Tata Consultancy' },
        { symbol: 'HDFCBANK.NS', name: 'HDFC Bank' },
        { symbol: 'ICICIBANK.NS', name: 'ICICI Bank' },
        { symbol: 'INFY.NS', name: 'Infosys' },
        { symbol: 'SBIN.NS', name: 'State Bank of India' },
        { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel' },
        { symbol: 'TATAMOTORS.NS', name: 'Tata Motors' },
        { symbol: 'ITC.NS', name: 'ITC' },
      ],
    },
    {
      name: 'US tech',
      items: [
        { symbol: 'AAPL', name: 'Apple' },
        { symbol: 'MSFT', name: 'Microsoft' },
        { symbol: 'NVDA', name: 'NVIDIA' },
        { symbol: 'GOOGL', name: 'Alphabet' },
        { symbol: 'AMZN', name: 'Amazon' },
        { symbol: 'META', name: 'Meta' },
        { symbol: 'TSLA', name: 'Tesla' },
      ],
    },
    {
      name: 'Crypto & commodities',
      items: [
        { symbol: 'BTC-USD', name: 'Bitcoin' },
        { symbol: 'ETH-USD', name: 'Ethereum' },
        { symbol: 'GC=F', name: 'Gold futures' },
        { symbol: 'SI=F', name: 'Silver futures' },
        { symbol: 'CL=F', name: 'Crude oil' },
        { symbol: 'USDINR=X', name: 'USD / INR' },
      ],
    },
  ];

  /* ---------------------------------------------------------------------
   * Watchlists are written once, but each data source spells symbols its own
   * way: yfinance wants RELIANCE.NS and ^NSEI, Zerodha wants NSE:RELIANCE and
   * NSE:NIFTY 50. Translate on the way into a pane rather than making people
   * keep a separate list per broker.
   *
   * US stocks, crypto and commodities have no Zerodha equivalent at all, so
   * those return null and the click is refused with an explanation.
   * ------------------------------------------------------------------- */
  const INDEX_MAP = [
    ['^NSEI', 'NSE:NIFTY 50'],
    ['^NSEBANK', 'NSE:NIFTY BANK'],
    ['^BSESN', 'BSE:SENSEX'],
    ['^CNXIT', 'NSE:NIFTY IT'],
  ];

  function toZerodha(symbol) {
    if (/^(NSE|BSE|NFO|MCX):/.test(symbol)) return symbol;
    const hit = INDEX_MAP.find((m) => m[0] === symbol);
    if (hit) return hit[1];
    if (symbol.endsWith('.NS')) return 'NSE:' + symbol.slice(0, -3);
    if (symbol.endsWith('.BO')) return 'BSE:' + symbol.slice(0, -3);
    return null;                       // not an Indian listing Zerodha carries
  }

  function toYahoo(symbol) {
    const hit = INDEX_MAP.find((m) => m[1] === symbol);
    if (hit) return hit[0];
    if (symbol.startsWith('NSE:')) return symbol.slice(4) + '.NS';
    if (symbol.startsWith('BSE:')) return symbol.slice(4) + '.BO';
    return symbol;
  }

  function forSource(symbol, sourceKey) {
    if (sourceKey === 'zerodha') return toZerodha(symbol);
    return toYahoo(symbol);
  }

  const Watchlist = {
    forSource,
    lists: null,
    active: 0,
    el: null,

    load() {
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) {}
      const fresh = JSON.parse(JSON.stringify(DEFAULTS));

      if (!Array.isArray(stored) || !stored.length) { this.lists = fresh; return; }

      /* Self-heal: a stored list that has lost its items (an interrupted save,
       * an older format) gets its defaults back rather than showing an empty
       * drawer with no way out. */
      this.lists = stored.map((list) => {
        const ok = list && typeof list.name === 'string';
        if (!ok) return null;
        if (Array.isArray(list.items) && list.items.length) return list;
        const seed = fresh.find((d) => d.name === list.name);
        return seed ? seed : { name: list.name, items: [] };
      }).filter(Boolean);

      if (!this.lists.length) this.lists = fresh;
    },

    reset() {
      try { localStorage.removeItem(KEY); } catch (_) {}
      this.lists = JSON.parse(JSON.stringify(DEFAULTS));
      this.active = 0;
      this.render();
    },

    save() {
      try { localStorage.setItem(KEY, JSON.stringify(this.lists)); } catch (_) {}
    },

    toggle() {
      const open = this.el.hidden;
      this.el.hidden = !open;
      document.getElementById('toggle-watchlist').classList.toggle('on', open);
      if (open) this.render();
      global.App.panes.forEach((p) => p.resize());
    },

    render() {
      const tabs = document.getElementById('wl-tabs');
      tabs.innerHTML = '';
      this.lists.forEach((list, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'wl-tab' + (i === this.active ? ' on' : '');
        b.textContent = list.name;
        b.addEventListener('click', () => { this.active = i; this.render(); });
        tabs.appendChild(b);
      });
      this.renderItems();
    },

    renderItems(query) {
      const host = document.getElementById('wl-items');
      const list = this.lists[this.active];
      const q = (query || '').trim().toLowerCase();
      host.innerHTML = '';
      const items = list.items.filter((it) =>
        !q || it.symbol.toLowerCase().includes(q) || (it.name || '').toLowerCase().includes(q));

      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'pop-empty';
        empty.textContent = q ? 'Nothing matches.' : 'This list is empty.';
        host.appendChild(empty);
        return;
      }

      items.forEach((it) => {
        const row = document.createElement('div');
        row.className = 'wl-item';
        const sym = document.createElement('span');
        sym.className = 'wl-sym';
        sym.textContent = it.symbol;
        const name = document.createElement('span');
        name.className = 'wl-name';
        name.textContent = it.name || '';
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'wl-del';
        del.textContent = '✕';
        del.title = 'Remove';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          list.items = list.items.filter((x) => x.symbol !== it.symbol);
          this.save();
          this.renderItems(document.getElementById('wl-search').value);
        });
        row.addEventListener('click', () => global.App.loadSymbol(it.symbol));
        const pane = global.App.panes[global.App.activeIndex];
        if (pane && forSource(it.symbol, pane.source.key) === null) {
          row.classList.add('unavailable');
          row.title = it.symbol + ' is not available on ' + pane.source.label;
        }
        row.append(sym, name, del);
        host.appendChild(row);
      });
    },

    add(symbol) {
      const sym = (symbol || '').trim().toUpperCase();
      if (!sym) return;
      const list = this.lists[this.active];
      if (!list.items.some((i) => i.symbol === sym)) {
        list.items.push({ symbol: sym, name: '' });
        this.save();
      }
      this.renderItems();
    },

    wire() {
      this.load();
      this.el = document.getElementById('watchlist');
      document.getElementById('toggle-watchlist').addEventListener('click', () => this.toggle());
      document.getElementById('wl-close').addEventListener('click', () => this.toggle());
      document.getElementById('wl-search').addEventListener('input', (e) => this.renderItems(e.target.value));
      const addBtn = document.getElementById('wl-add-btn');
      const addIn = document.getElementById('wl-add');
      const doAdd = () => { this.add(addIn.value); addIn.value = ''; };
      addBtn.addEventListener('click', doAdd);
      addIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
      const reset = document.getElementById('wl-reset');
      if (reset) reset.addEventListener('click', () => this.reset());
    },
  };

  global.Watchlist = Watchlist;
})(window);

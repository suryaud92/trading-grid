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

  const Watchlist = {
    lists: null,
    active: 0,
    el: null,

    load() {
      try {
        const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (Array.isArray(raw) && raw.length) { this.lists = raw; return; }
      } catch (_) {}
      this.lists = JSON.parse(JSON.stringify(DEFAULTS));
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
    },
  };

  global.Watchlist = Watchlist;
})(window);

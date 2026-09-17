/* optionchain.js — the NSE-style option chain view.
 *
 * Calls and puts either side of the strike column, in-the-money rows tinted,
 * the at-the-money row marked. Needs a live Zerodha session: yfinance has no
 * Indian options, so there is no free fallback for this screen.
 */
(function (global) {
  'use strict';

  const KEY = 'ltg.oc.v1';

  const OptionChain = {
    underlyings: [],
    state: { underlying: 'NIFTY', expiry: null, around: 20, center: null },
    data: null,
    timer: null,
    mounted: false,

    load() {
      try {
        const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
        Object.assign(this.state, saved);
      } catch (_) {}
    },
    save() {
      try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (_) {}
    },

    async activate() {
      this.load();
      if (!this.underlyings.length) {
        try {
          const res = await Feeds.api.json('/api/optionchain/underlyings');
          this.underlyings = res.underlyings || [];
        } catch (err) {
          this.status('Could not load the contract list: ' + err.message, true);
          return;
        }
      }
      this.renderControls();
      await this.refresh();
      clearInterval(this.timer);
      this.timer = setInterval(() => {
        if (!document.hidden) this.refresh(true);
      }, 5000);
    },

    deactivate() { clearInterval(this.timer); this.timer = null; },

    status(text, isError) {
      const el = document.getElementById('oc-status');
      el.textContent = text || '';
      el.classList.toggle('error', !!isError);
      el.hidden = !text;
    },

    renderControls() {
      /* 216 underlyings is too many for a plain dropdown, so it is a text box
       * backed by a datalist: type to narrow, or open it and scroll. */
      const list = document.getElementById('oc-underlying-list');
      if (list.options.length !== this.underlyings.length) {
        list.innerHTML = '';
        this.underlyings.forEach((u) => {
          const o = document.createElement('option');
          o.value = u.name;
          list.appendChild(o);
        });
      }
      if (!this.underlyings.some((u) => u.name === this.state.underlying)) {
        this.state.underlying = (this.underlyings[0] || {}).name || 'NIFTY';
      }
      document.getElementById('oc-underlying').value = this.state.underlying;
      document.getElementById('oc-around').value = this.state.around;

      const eSel = document.getElementById('oc-expiry');
      const found = this.underlyings.find((u) => u.name === this.state.underlying);
      const exps = (found && found.expiries) || [];
      eSel.innerHTML = '';
      exps.forEach((e) => {
        const o = document.createElement('option');
        o.value = e;
        o.textContent = e;
        eSel.appendChild(o);
      });
      if (!exps.includes(this.state.expiry)) this.state.expiry = exps[0] || null;
      eSel.value = this.state.expiry || '';
    },

    async refresh(quiet) {
      if (!quiet) this.status('Loading chain…');
      const q = '/api/optionchain?underlying=' + encodeURIComponent(this.state.underlying)
        + (this.state.expiry ? '&expiry=' + encodeURIComponent(this.state.expiry) : '')
        + '&around=' + this.state.around
        + (this.state.center != null ? '&center=' + this.state.center : '');
      try {
        this.data = await Feeds.api.json(q);
        this.status('');
        this.renderTable();
      } catch (err) {
        if (!quiet) this.status(err.message, true);
      }
    },

    renderTable() {
      const d = this.data;
      const body = document.getElementById('oc-body');
      const spot = d.spot;

      this.renderStrikes(d);

      document.getElementById('oc-spot').textContent = spot == null ? '—'
        : d.underlying + '  ' + spot.toLocaleString(undefined, { maximumFractionDigits: 2 });
      document.getElementById('oc-meta').textContent =
        d.expiry + ' · ' + d.daysToExpiry + ' days to expiry';

      /* nearest strike to spot: the row everything is read outward from */
      let atm = null, best = Infinity;
      d.rows.forEach((r) => {
        const gap = spot == null ? Infinity : Math.abs(r.strike - spot);
        if (gap < best) { best = gap; atm = r.strike; }
      });

      const num = (v, dp) => (v == null ? '–'
        : Number(v).toLocaleString(undefined, { minimumFractionDigits: dp || 0,
                                                maximumFractionDigits: dp || 0 }));
      body.innerHTML = '';
      d.rows.forEach((r) => {
        const tr = document.createElement('tr');
        const traded = (r.call && r.call.traded) || (r.put && r.put.traded);
        tr.className = (r.strike === atm ? 'atm' : '') + (traded ? '' : ' dead');
        const c = r.call || {}, p = r.put || {};
        /* calls are in the money below spot, puts above — NSE shades it the
         * same way and it is how you read the chain at a glance */
        const callItm = spot != null && r.strike < spot;
        const putItm = spot != null && r.strike > spot;

        const cells = [
          ['c' + (callItm ? ' itm' : ''), num(c.oi)],
          ['c' + (callItm ? ' itm' : ''), num(c.volume)],
          ['c' + (callItm ? ' itm' : ''), c.iv == null ? '–' : c.iv.toFixed(1)],
          ['c num' + (callItm ? ' itm' : ''), num(c.ltp, 2)],
          ['c ' + chgClass(c.change) + (callItm ? ' itm' : ''), num(c.change, 2)],
          ['c' + (callItm ? ' itm' : ''), num(c.bid, 2)],
          ['c' + (callItm ? ' itm' : ''), num(c.ask, 2)],
          ['strike', num(r.strike, 2)],
          ['p' + (putItm ? ' itm' : ''), num(p.bid, 2)],
          ['p' + (putItm ? ' itm' : ''), num(p.ask, 2)],
          ['p ' + chgClass(p.change) + (putItm ? ' itm' : ''), num(p.change, 2)],
          ['p num' + (putItm ? ' itm' : ''), num(p.ltp, 2)],
          ['p' + (putItm ? ' itm' : ''), p.iv == null ? '–' : p.iv.toFixed(1)],
          ['p' + (putItm ? ' itm' : ''), num(p.volume)],
          ['p' + (putItm ? ' itm' : ''), num(p.oi)],
        ];
        cells.forEach(([cls, text]) => {
          const td = document.createElement('td');
          td.className = cls;
          td.textContent = text;
          tr.appendChild(td);
        });
        body.appendChild(tr);
      });

      this.measureHeader();

      if (!this._scrolledOnce && atm != null) {
        this._scrolledOnce = true;
        const row = body.querySelector('.atm');
        if (row) row.scrollIntoView({ block: 'center' });
      }
    },

    /* The two header rows are both sticky; the second must sit exactly under
     * the first. Measure rather than guess — a wrong offset leaves a sliver
     * that scrolling rows show through. */
    measureHeader() {
      const first = document.querySelector('.oc-table thead tr.oc-group');
      if (!first) return;
      const h = Math.ceil(first.getBoundingClientRect().height);
      if (h > 0) {
        document.documentElement.style.setProperty('--oc-head1', h + 'px');
      }
    },

    /** Every strike for this expiry, so you can jump anywhere in the chain. */
    renderStrikes(d) {
      const sel = document.getElementById('oc-strike');
      const strikes = d.strikes || [];
      const want = String(this.state.center != null ? this.state.center : (d.center || ''));
      if (sel.dataset.key !== d.underlying + d.expiry) {
        sel.dataset.key = d.underlying + d.expiry;
        sel.innerHTML = '';
        const auto = document.createElement('option');
        auto.value = '';
        auto.textContent = 'At the money';
        sel.appendChild(auto);
        strikes.forEach((k) => {
          const o = document.createElement('option');
          o.value = String(k);
          o.textContent = k.toLocaleString(undefined, { maximumFractionDigits: 2 });
          sel.appendChild(o);
        });
      }
      sel.value = this.state.center != null ? want : '';
    },

    wire() {
      document.getElementById('oc-underlying').addEventListener('change', (e) => {
        const typed = (e.target.value || '').trim().toUpperCase();
        const match = this.underlyings.find((u) => u.name === typed);
        if (!match) {
          this.status('No listed options for "' + typed + '".', true);
          e.target.value = this.state.underlying;
          return;
        }
        this.state.underlying = match.name;
        this.state.expiry = null;
        this.state.center = null;
        this._scrolledOnce = false;
        this.save();
        this.renderControls();
        this.refresh();
      });
      document.getElementById('oc-strike').addEventListener('change', (e) => {
        this.state.center = e.target.value ? Number(e.target.value) : null;
        this._scrolledOnce = false;
        this.save();
        this.refresh();
      });
      document.getElementById('oc-around').addEventListener('change', (e) => {
        this.state.around = Math.max(5, Math.min(Number(e.target.value) || 20, 60));
        e.target.value = this.state.around;
        this.save();
        this.refresh();
      });
      document.getElementById('oc-expiry').addEventListener('change', (e) => {
        this.state.expiry = e.target.value;
        this._scrolledOnce = false;
        this.save();
        this.refresh();
      });
      document.getElementById('oc-refresh').addEventListener('click', () => this.refresh());
      window.addEventListener('resize', () => this.measureHeader());
    },
  };

  function chgClass(v) {
    if (v == null) return '';
    return v > 0 ? 'up' : v < 0 ? 'down' : '';
  }

  global.OptionChain = OptionChain;
})(window);

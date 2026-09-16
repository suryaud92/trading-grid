/* indicators.js — client side of the indicator system.
 *
 * The maths used to live here in JavaScript. It now runs on the server with
 * pandas-ta (see indicators.py), which buys us 14 indicators instead of 5 and
 * one place to add more. This file just caches the catalog and turns a pane's
 * configuration into the compact spec string the API expects.
 *
 * Config shape, stored per pane and persisted:
 *     [ {id: 'sma', params: [20]}, {id: 'sma', params: [50]}, {id: 'rsi', params: [14]} ]
 * Spec string sent to /api/candles:
 *     sma:20,sma:50,rsi:14
 */
(function (global) {
  'use strict';

  const Indicators = {
    catalog: [],
    byId: {},
    loaded: false,

    async load() {
      if (this.loaded) return this.catalog;
      const { indicators } = await Feeds.api.json('/api/indicators');
      this.catalog = indicators || [];
      this.byId = {};
      this.catalog.forEach((s) => { this.byId[s.id] = s; });
      this.loaded = true;
      return this.catalog;
    },

    spec(list) {
      return (list || [])
        .filter((e) => this.byId[e.id])
        .map((e) => [e.id].concat(e.params || []).join(':'))
        .join(',');
    },

    /** Defaults for a freshly added indicator. */
    defaults(id) {
      const s = this.byId[id];
      return s ? s.params.map((p) => p.default) : [];
    },

    label(entry) {
      const s = this.byId[entry.id];
      if (!s) return entry.id;
      const ps = (entry.params || []).join(', ');
      return s.label + (ps ? ' ' + ps : '');
    },

    isSub(id) {
      const s = this.byId[id];
      return !!s && s.pane === 'sub';
    },

    /** Drop anything the server no longer offers, and cap the list. */
    clean(list) {
      const out = [];
      let subUsed = false;
      (list || []).forEach((e) => {
        if (!e || !this.byId[e.id]) return;
        if (this.isSub(e.id)) {
          if (subUsed) return;          // only one sub-pane at a time
          subUsed = true;
        }
        out.push({ id: e.id, params: (e.params || []).map(Number) });
      });
      return out.slice(0, 8);
    },
  };

  global.Indicators = Indicators;
})(window);

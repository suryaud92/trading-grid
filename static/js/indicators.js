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

  const FAV_KEY = 'ltg.fxmenu.v1';

  const Indicators = {
    catalog: [],          // everything the server offers (~194)
    byId: {},
    favourites: null,     // ids shown in the fx menu; null = the curated default
    loaded: false,

    async load() {
      if (this.loaded) return this.catalog;
      const { indicators } = await Feeds.api.json('/api/indicators');
      this.catalog = indicators || [];
      this.byId = {};
      this.catalog.forEach((s) => { this.byId[s.id] = s; });
      this.loadFavourites();
      this.loaded = true;
      return this.catalog;
    },

    /* ---- which indicators the fx menu offers -------------------------- */

    loadFavourites() {
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem(FAV_KEY) || 'null'); } catch (_) {}

      // legacy shape: a bare array of ids
      if (Array.isArray(stored)) stored = { ids: stored, known: stored };

      if (!stored || !Array.isArray(stored.ids) || !stored.ids.length) {
        this.favourites = this.defaultFavourites();
        return this.favourites;
      }

      const ids = stored.ids.filter((id) => this.byId[id]);
      /* An indicator added to the app after you last saved is new, not
       * something you chose to hide — so curated newcomers join the menu while
       * anything you deliberately unticked stays out. */
      const knownThen = new Set(stored.known || stored.ids);
      this.catalog.forEach((s2) => {
        if (s2.curated && !knownThen.has(s2.id) && ids.indexOf(s2.id) === -1) {
          ids.push(s2.id);
        }
      });

      this.favourites = ids;
      this.saveFavourites(ids);
      return this.favourites;
    },

    defaultFavourites() {
      return this.catalog.filter((s) => s.curated).map((s) => s.id);
    },

    saveFavourites(ids) {
      this.favourites = (ids || []).filter((id) => this.byId[id]);
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify({
          ids: this.favourites,
          known: this.catalog.map((s2) => s2.id),   // so later additions are detectable
        }));
      } catch (_) {}
    },

    resetFavourites() {
      try { localStorage.removeItem(FAV_KEY); } catch (_) {}
      this.favourites = this.defaultFavourites();
    },

    isFavourite(id) { return (this.favourites || []).indexOf(id) !== -1; },

    /** What the fx menu lists. */
    menuCatalog() {
      const fav = this.favourites || [];
      return this.catalog.filter((s) => fav.indexOf(s.id) !== -1);
    },

    /** includeOverlays=false leaves Volume Profile / FVG out of the request. */
    spec(list, includeOverlays) {
      return (list || [])
        .filter((e) => this.byId[e.id])
        .filter((e) => includeOverlays !== false || !this.isOverlay(e.id))
        .map((e) => [e.id].concat(e.params || []).join(':'))
        .join(',');
    },

    hasOverlay(list) {
      return (list || []).some((e) => this.isOverlay(e.id));
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

    isOverlay(id) {
      const s = this.byId[id];
      return !!s && s.pane === 'overlay';
    },

    isMarker(id) {
      const s = this.byId[id];
      return !!s && s.pane === 'markers';
    },

    /* Bands stack vertically, so more than a few makes each unreadable in a
     * small grid pane. Overlays have no such limit. */
    MAX_BANDS: 3,

    /** Drop anything the server no longer offers, and cap the list. */
    clean(list) {
      const out = [];
      let bands = 0;
      (list || []).forEach((e) => {
        if (!e || !this.byId[e.id]) return;
        if (this.isMarker(e.id)) { out.push({ id: e.id, params: [] }); return; }
        if (this.isSub(e.id)) {
          if (bands >= this.MAX_BANDS) return;
          bands += 1;
        }
        out.push({
          id: e.id,
          // a choice parameter is a string; Number() would turn it into NaN
          params: (e.params || []).map((v) =>
            (typeof v === 'string' && isNaN(Number(v))) ? v : Number(v)),
        });
      });
      return out.slice(0, 10);
    },

    bandCount(list) {
      return (list || []).filter((e) => this.isSub(e.id)).length;
    },
  };

  global.Indicators = Indicators;
})(window);

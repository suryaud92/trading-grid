/* settings.js — the Settings dialog. Broker credentials live on the SERVER;
 * this screen only ever sees masked values and a connection status. */
(function (global) {
  'use strict';

  const Settings = {
    el: null,
    state: null,

    open(focus) {
      this.el = document.getElementById('settings');
      this.el.hidden = false;
      this.refresh();
      this.renderIndicatorPicker();
      if (focus === 'indicators') {
        const card = document.getElementById('ind-card');
        if (card) setTimeout(() => card.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
      }
    },

    /* ---------------------------------------------------------------------
     * Which indicators the fx menu offers. Stored per browser, not on the
     * server — it is a display preference, not a credential.
     * ------------------------------------------------------------------- */
    async renderIndicatorPicker() {
      const list = document.getElementById('ind-list');
      if (!list) return;
      try {
        await Indicators.load();
      } catch (err) {
        list.textContent = 'Could not load the indicator list: ' + err.message;
        return;
      }
      this.drawIndicatorList();
    },

    drawIndicatorList(query) {
      const list = document.getElementById('ind-list');
      const needle = (query || '').trim().toLowerCase();
      const chosen = Indicators.favourites || [];
      document.getElementById('ind-count').textContent =
        chosen.length + ' of ' + Indicators.catalog.length + ' shown';

      const matches = Indicators.catalog.filter((s) =>
        !needle || s.id.includes(needle) || s.label.toLowerCase().includes(needle)
        || (s.note || '').toLowerCase().includes(needle));

      list.innerHTML = '';
      if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'pop-empty';
        empty.textContent = 'Nothing matches "' + query + '".';
        list.appendChild(empty);
        return;
      }

      [['price', 'Drawn on the chart'], ['overlay', 'Drawn over the chart'], ['markers', 'Candlestick patterns'], ['sub', 'Drawn in a band below']].forEach(([kind, heading]) => {
        const group = matches.filter((s) => s.pane === kind);
        if (!group.length) return;
        const h = document.createElement('div');
        h.className = 'pop-sub';
        h.textContent = heading + ' (' + group.length + ')';
        list.appendChild(h);

        group.forEach((s) => {
          const row = document.createElement('label');
          row.className = 'ind-row' + (s.curated ? ' curated' : '');
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = Indicators.isFavourite(s.id);
          cb.addEventListener('change', () => {
            const next = (Indicators.favourites || []).slice();
            const at = next.indexOf(s.id);
            if (cb.checked && at === -1) next.push(s.id);
            if (!cb.checked && at !== -1) next.splice(at, 1);
            Indicators.saveFavourites(next);
            this.drawIndicatorList(document.getElementById('ind-search').value);
          });
          const dot = document.createElement('span');
          dot.className = 'pop-swatch';
          dot.style.background = (s.lines[0] && s.lines[0].color) || '#64748b';
          const name = document.createElement('span');
          name.className = 'ind-name';
          name.textContent = s.label;
          const note = document.createElement('span');
          note.className = 'ind-note';
          note.textContent = s.note || '';
          row.append(cb, dot, name, note);
          list.appendChild(row);
        });
      });
    },

    close() {
      if (this.el) this.el.hidden = true;
      if (this.dirty) { this.dirty = false; global.App.reloadSources(); }
    },

    async refresh() {
      this.status('Loading…');
      try {
        this.state = await Feeds.api.settings();
        this.render();
      } catch (err) {
        this.status(err.message, true);
      }
    },

    status(text, isError) {
      const n = document.getElementById('set-status');
      n.textContent = text || '';
      n.classList.toggle('error', !!isError);
      n.hidden = !text;
    },

    render() {
      const k = this.state.kite;
      document.getElementById('set-user').textContent = this.state.user || '—';

      /* Say plainly whether anything typed here will survive a restart. */
      const chip = document.getElementById('set-persist');
      if (this.state.persistent) {
        chip.textContent = 'saved permanently';
        chip.dataset.state = 'on';
        chip.title = 'Settings are stored in Firestore, so they are shared '
          + 'across your devices and survive redeploys.';
      } else {
        chip.textContent = 'this server only';
        chip.dataset.state = 'off';
        chip.title = 'Settings live on the server\u2019s disk. On a free host that '
          + 'disk is wiped on every restart, so you will have to reconnect. '
          + 'Set FIREBASE_SERVICE_ACCOUNT to store them permanently.';
      }

      this.renderDefaultSource();

      /* Once saved, the app credentials are a fact, not a form. */
      const savedRow = document.getElementById('kite-creds-saved');
      const form = document.getElementById('kite-creds-form');
      const haveBoth = !!(k.apiKey && k.apiSecretSet);
      if (haveBoth && !this._editingCreds) {
        savedRow.hidden = false;
        form.hidden = true;
        document.getElementById('kite-key-shown').textContent = k.apiKey;
      } else {
        savedRow.hidden = true;
        form.hidden = false;
      }

      const badge = document.getElementById('kite-badge');
      badge.textContent = k.connected ? 'Connected' : 'Not connected';
      badge.dataset.state = k.connected ? 'on' : 'off';

      const detail = document.getElementById('kite-detail');
      if (k.connected) {
        const age = k.connectedHoursAgo;
        const stale = age != null && age > 12;
        detail.innerHTML = '';
        detail.append(
          text(`${k.user ? k.user + ' · ' : ''}token ${k.accessTokenMasked}`),
          el('br'),
          text(age == null ? '' : `connected ${age < 1 ? 'less than an hour' : age + ' hours'} ago`
            + (stale ? ' — Kite tokens expire around 6am IST, so reconnect if charts fail.' : ''))
        );
      } else {
        detail.textContent = k.apiKey
          ? 'API key saved. Sign in to Kite below to start the live feed.'
          : 'Enter the API key and secret from your Kite Connect app.';
      }

      const keyIn = document.getElementById('kite-key');
      if (document.activeElement !== keyIn) keyIn.value = k.apiKey || '';
      const secIn = document.getElementById('kite-secret');
      secIn.placeholder = k.apiSecretSet ? k.apiSecretMasked + ' (saved — leave blank to keep)'
                                         : 'Kite API secret';

      document.getElementById('kite-env-note').hidden =
        !(k.envManaged.apiKey || k.envManaged.apiSecret);
      document.getElementById('kite-step2').hidden = !k.apiKey;
      document.getElementById('kite-disconnect').hidden = !k.connected;
      this.status('');
    },

    renderDefaultSource() {
      const sel = document.getElementById('set-default-source');
      if (!sel) return;
      const sources = (this.state.sources || []);
      sel.innerHTML = '';
      const auto = document.createElement('option');
      auto.value = '';
      auto.textContent = 'Automatic (prefer the live broker)';
      sel.appendChild(auto);
      sources.forEach((key) => {
        const o = document.createElement('option');
        o.value = key;
        o.textContent = (App.sources[key] && App.sources[key].label) || key;
        sel.appendChild(o);
      });
      sel.value = this.state.defaultSource || '';
    },

    async setDefaultSource(key) {
      this.status('Saving…');
      try {
        this.state = await Feeds.api.post('/api/settings/default-source', { source: key });
        this.dirty = true;
        this.render();
        this.status('New charts will open on '
          + (key ? (App.sources[key] || {}).label || key : 'the live broker when available') + '.');
      } catch (err) { this.status(err.message, true); }
    },

    async saveApp() {
      const apiKey = document.getElementById('kite-key').value.trim();
      const apiSecret = document.getElementById('kite-secret').value.trim();
      if (!apiKey) return this.status('API key is required', true);
      this.status('Saving…');
      try {
        this.state = await Feeds.api.post('/api/settings/kite', { apiKey, apiSecret });
        document.getElementById('kite-secret').value = '';
        this._editingCreds = false;
        this.dirty = true;
        this.render();
        this.status('Saved.' + (this.state.persistent ? '' :
          ' Note: this server does not store settings permanently.'));
      } catch (err) { this.status(err.message, true); }
    },

    async openKiteLogin() {
      this.status('Getting your Kite login URL…');
      try {
        const { loginUrl } = await Feeds.api.json('/api/settings/kite/login-url');
        this.status('');
        global.open(loginUrl, '_blank', 'noopener');
        document.getElementById('kite-token').focus();
      } catch (err) { this.status(err.message, true); }
    },

    /** Accepts a bare request_token or the whole redirect URL pasted in. */
    async connect() {
      const raw = document.getElementById('kite-token').value.trim();
      if (!raw) return this.status('Paste the request_token (or the redirect URL)', true);
      let requestToken = raw;
      if (raw.includes('request_token=')) {
        try {
          requestToken = new URL(raw).searchParams.get('request_token') || raw;
        } catch (_) {
          requestToken = (raw.match(/request_token=([^&\s]+)/) || [])[1] || raw;
        }
      }
      this.status('Connecting to Kite…');
      try {
        this.state = await Feeds.api.post('/api/settings/kite/connect', { requestToken });
        document.getElementById('kite-token').value = '';
        this.dirty = true;
        this.render();
        this.status('Connected. "Zerodha (Kite)" is now in every pane\'s source list.');
      } catch (err) { this.status(err.message, true); }
    },

    async disconnect() {
      this.status('Disconnecting…');
      try {
        this.state = await Feeds.api.post('/api/settings/kite/disconnect');
        this.dirty = true;
        this.render();
        this.status('Disconnected.');
      } catch (err) { this.status(err.message, true); }
    },

    wire() {
      document.getElementById('open-settings').addEventListener('click', () => this.open());
      document.getElementById('set-close').addEventListener('click', () => this.close());
      document.getElementById('settings').addEventListener('click', (e) => {
        if (e.target.id === 'settings') this.close();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.el && !this.el.hidden) this.close();
      });
      document.getElementById('kite-save').addEventListener('click', () => this.saveApp());
      const edit = document.getElementById('kite-edit');
      if (edit) {
        edit.addEventListener('click', () => {
          this._editingCreds = true;
          this.render();
          document.getElementById('kite-key').focus();
        });
      }
      const defSel = document.getElementById('set-default-source');
      if (defSel) defSel.addEventListener('change', () => this.setDefaultSource(defSel.value));
      const applyAll = document.getElementById('set-apply-all');
      if (applyAll) {
        applyAll.addEventListener('click', () => {
          const key = document.getElementById('set-default-source').value
            || (App.sources.zerodha ? 'zerodha' : Object.keys(App.sources)[0]);
          const n = App.switchAllTo(key);
          this.status(n ? n + ' chart(s) switched to ' + (App.sources[key].label) + '.'
                        : 'All charts are already on that feed.');
        });
      }
      document.getElementById('kite-login').addEventListener('click', () => this.openKiteLogin());
      document.getElementById('kite-connect').addEventListener('click', () => this.connect());
      document.getElementById('kite-disconnect').addEventListener('click', () => this.disconnect());

      const search = document.getElementById('ind-search');
      if (search) {
        search.addEventListener('input', () => this.drawIndicatorList(search.value));
      }
      const reset = document.getElementById('ind-reset');
      if (reset) {
        reset.addEventListener('click', () => {
          Indicators.resetFavourites();
          document.getElementById('ind-search').value = '';
          this.drawIndicatorList('');
        });
      }
    },
  };

  function el(t) { return document.createElement(t); }
  function text(s) { return document.createTextNode(s); }

  global.Settings = Settings;
  document.addEventListener('DOMContentLoaded', () => Settings.wire());
})(window);

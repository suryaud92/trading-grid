/* alerts.js — price alerts.
 *
 * Alerts fire on a CROSSING, not merely on the condition being true. Setting
 * "above 100" while the price is already 105 does not fire instantly; the
 * alert arms itself once the price drops back below, then fires on the way up.
 * Otherwise every alert you set would go off the moment you created it.
 *
 * They are checked in the browser against the live price feed, so they only
 * work while the dashboard is open in a tab. There is no server-side watcher
 * and nothing will reach you overnight.
 */
(function (global) {
  'use strict';

  const KEY = 'ltg.alerts.v1';

  const Alerts = {
    items: [],
    listeners: new Set(),

    load() {
      try {
        const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
        this.items = Array.isArray(raw) ? raw : [];
      } catch (_) { this.items = []; }
      return this.items;
    },

    save() {
      try { localStorage.setItem(KEY, JSON.stringify(this.items)); } catch (_) {}
      this.listeners.forEach((fn) => { try { fn(); } catch (_) {} });
    },

    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },

    forSymbol(source, symbol) {
      return this.items.filter((a) => a.source === source && a.symbol === symbol);
    },

    add(source, symbol, dir, price, currentPrice) {
      const conditionAlreadyTrue = currentPrice != null &&
        (dir === 'above' ? currentPrice >= price : currentPrice <= price);
      const alert = {
        id: 'a' + Date.now() + Math.random().toString(36).slice(2, 7),
        source, symbol, dir,
        price: Number(price),
        created: Date.now(),
        armed: !conditionAlreadyTrue,
        triggered: false,
      };
      this.items.push(alert);
      this.save();
      requestPermission();
      return alert;
    },

    remove(id) {
      this.items = this.items.filter((a) => a.id !== id);
      this.save();
    },

    clearTriggered() {
      this.items = this.items.filter((a) => !a.triggered);
      this.save();
    },

    /** Called on every price tick for a pane's symbol. */
    check(source, symbol, price, label) {
      if (typeof price !== 'number' || !isFinite(price)) return;
      let changed = false;
      for (const a of this.items) {
        if (a.source !== source || a.symbol !== symbol || a.triggered) continue;
        const hit = a.dir === 'above' ? price >= a.price : price <= a.price;
        if (!a.armed) {
          if (!hit) { a.armed = true; changed = true; }   // price left the zone: arm it
          continue;
        }
        if (hit) {
          a.triggered = true;
          a.triggeredAt = Date.now();
          a.triggeredPrice = price;
          changed = true;
          fire(a, label || symbol, price);
        }
      }
      if (changed) this.save();
    },
  };

  /* ------------------------------------------------------------ firing */

  function fire(alert, label, price) {
    const dir = alert.dir === 'above' ? 'rose above' : 'fell below';
    const text = `${label} ${dir} ${alert.price}`;
    toast(text, `now ${price}`, alert.dir);
    beep(alert.dir === 'above');
    notify(text, `Currently ${price}`);
  }

  function requestPermission() {
    try {
      if (global.Notification && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    } catch (_) {}
  }

  function notify(title, body) {
    try {
      if (global.Notification && Notification.permission === 'granted') {
        new Notification(title, { body: body, tag: title });
      }
    } catch (_) {}
  }

  function toast(title, sub, dir) {
    let host = document.getElementById('toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toasts';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'toast ' + dir;
    const t = document.createElement('strong');
    t.textContent = title;
    const s = document.createElement('span');
    s.textContent = sub;
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '✕';
    x.addEventListener('click', () => el.remove());
    el.append(t, s, x);
    host.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 12000);
  }

  /* A short two-tone chime, synthesised so there's no audio file to ship.
   * Browsers block audio until the user has interacted with the page; since
   * creating an alert is an interaction, by the time one fires we're fine. */
  function beep(up) {
    try {
      const Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return;
      const ctx = beep._ctx || (beep._ctx = new Ctx());
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      [0, 0.16].forEach((offset, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = up ? (i ? 1046 : 784) : (i ? 587 : 784);
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.12, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.14);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.16);
      });
    } catch (_) {}
  }

  Alerts.load();
  global.Alerts = Alerts;
})(window);
